import { Router } from "express";
import { withWorkspace, systemQuery } from "../db.js";
import { Problem } from "../problem.js";
import { encryptToken, signState, verifyState } from "../services/crypto.js";
import { SfClient, clientCredentialsToken } from "../services/salesforce.js";

export const orgs = Router();          // bearer-authed workspace routes
export const orgsCallback = Router();  // public: browser lands here from Salesforce

const CALLBACK_PATH = "/v1/orgs/callback";

function oauthConfig() {
  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;
  const baseUrl = (process.env.APP_BASE_URL ?? "http://localhost:8080")
    .replace(/\/$/, "");
  return { clientId, clientSecret, redirectUri: baseUrl + CALLBACK_PATH };
}

orgs.get("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const { rows } = await client.query(
      `select id, sf_org_id, org_type, label, instance_url, status, auth_note,
              api_budget_daily, api_calls_today, last_synced_at
       from org_connection order by created_at`);
    res.json({ data: rows });
  }).catch(next);
});

// Start connecting an org. With SF_CLIENT_ID configured this returns a
// Salesforce authorize URL to open in a browser (the connected-app OAuth
// flow). Without it, a refresh_token can still be supplied directly (dev).
orgs.post("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const { label, org_type, login_url, sf_org_id, refresh_token, auth_mode,
            instance_url } = req.body ?? {};
    if (!label) throw new Problem(422, "Validation failed", "label is required");

    const { clientId, clientSecret, redirectUri } = oauthConfig();

    // Client credentials: validate the customer's connected-app run-as setup
    // right now by exchanging a token and reading the org id - a connect
    // either works immediately or fails with a clear error.
    if (auth_mode === "client_credentials") {
      if (!clientId || !clientSecret) {
        throw new Problem(500, "Not configured",
          "SF_CLIENT_ID / SF_CLIENT_SECRET missing on the server");
      }
      if (!instance_url) {
        throw new Problem(422, "Validation failed",
          "instance_url is required for client_credentials");
      }
      let orgId = "unknown";
      try {
        const token = await clientCredentialsToken(
          instance_url, clientId, clientSecret);
        const sf = new SfClient(token, instance_url);
        const rows = await sf.queryAll("select Id from Organization limit 1");
        orgId = rows[0]?.Id ?? "unknown";
      } catch (err: any) {
        throw new Problem(502, "Client credentials check failed",
          "Salesforce rejected the token exchange. Is the connected app"
          + " installed in that org with a run-as user configured?"
          + ` (${err?.body ?? err?.message ?? err})`);
      }
      const { rows: [org] } = await client.query(
        `insert into org_connection (workspace_id, sf_org_id, org_type, label,
           instance_url, oauth_refresh_token_enc, auth_mode, auth_note)
         values (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4,
           '\x00', 'client_credentials', 'client credentials (run-as user)')
         on conflict (workspace_id, sf_org_id) do update set
           auth_mode = 'client_credentials', instance_url = excluded.instance_url,
           status = 'active', auth_note = 'client credentials (reconnected)'
         returning id, label, instance_url, status, auth_mode`,
        [orgId, org_type ?? "production", label, instance_url]);
      res.status(201).json(org);
      return;
    }
    if (clientId && !refresh_token) {
      const login = String(login_url ?? process.env.SF_LOGIN_URL
                           ?? "https://login.salesforce.com").replace(/\/$/, "");
      const state = signState({
        ws: req.workspaceId, label, org_type: org_type ?? "sandbox",
        login, exp: Date.now() + 10 * 60 * 1000,
      });
      const authorizeUrl = login + "/services/oauth2/authorize?"
        + new URLSearchParams({
            response_type: "code", client_id: clientId,
            redirect_uri: redirectUri, scope: "api refresh_token",
            state,
          }).toString();
      res.status(201).json({ authorize_url: authorizeUrl });
      return;
    }

    // Dev fallback: direct insert with a supplied (or absent) refresh token.
    if (!sf_org_id || !login_url) {
      throw new Problem(422, "Validation failed",
        "without SF_CLIENT_ID, provide sf_org_id and login_url (instance URL)");
    }
    const { rows: [org] } = await client.query(
      `insert into org_connection (workspace_id, sf_org_id, org_type, label,
         instance_url, oauth_refresh_token_enc, auth_note)
       values (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4, $5, $6)
       returning id, label, instance_url, status`,
      [sf_org_id, org_type ?? "sandbox", label, login_url,
       Buffer.from(refresh_token ? encryptToken(refresh_token) : "", "utf8"),
       refresh_token ? "encrypted refresh token (dev insert)"
                     : "no token - worker uses SF_CLI_ALIAS/SF_ACCESS_TOKEN"]);
    res.status(201).json(org);
  }).catch(next);
});

// Reset the sync watermark: the next worker poll re-reads the full
// INITIAL_BACKFILL_DAYS window (dedupe makes re-ingesting safe).
orgs.post("/:id/resync", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const { rowCount } = await client.query(
      "update org_connection set last_synced_at = null where id = $1",
      [req.params.id]);
    if (!rowCount) throw new Problem(404, "Not found", `no org ${req.params.id}`);
    res.json({ id: req.params.id, resync: true });
  }).catch(next);
});

orgs.delete("/:id", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    await client.query(
      "update org_connection set status = 'paused' where id = $1",
      [req.params.id]);
    res.status(204).end();
  }).catch(next);
});

// Public browser redirect target. Auth comes from the signed state, not a
// bearer token. Exchanges the code, stores the encrypted refresh token.
orgsCallback.get("/", (req, res, next) => {
  (async () => {
    const err = String(req.query.error ?? "");
    if (err) {
      res.status(400).send(page("Connection refused",
        `Salesforce returned: ${err} - ${req.query.error_description ?? ""}`));
      return;
    }
    const state = verifyState(String(req.query.state ?? ""));
    if (!state) {
      res.status(400).send(page("Invalid state",
        "The connect link expired or was tampered with. Start again."));
      return;
    }
    const { clientId, clientSecret, redirectUri } = oauthConfig();
    if (!clientId || !clientSecret) {
      res.status(500).send(page("Not configured",
        "SF_CLIENT_ID / SF_CLIENT_SECRET missing on the server."));
      return;
    }
    const tokenRes = await fetch(
      String(state.login) + "/services/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: String(req.query.code ?? ""),
          client_id: clientId, client_secret: clientSecret,
          redirect_uri: redirectUri,
        }).toString(),
      });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.refresh_token) {
      res.status(502).send(page("Token exchange failed",
        JSON.stringify(token).slice(0, 300)
        + " (is the connected app configured for refresh_token scope?)"));
      return;
    }
    // identity URL: https://login.salesforce.com/id/<18-char org id>/<user id>
    const orgId = String(token.id ?? "").split("/id/")[1]?.split("/")[0]
      ?? "unknown";

    await systemQuery(
      `insert into org_connection (workspace_id, sf_org_id, org_type, label,
         instance_url, oauth_refresh_token_enc, auth_note)
       values ($1, $2, $3, $4, $5, $6, 'connected via OAuth')
       on conflict (workspace_id, sf_org_id) do update set
         oauth_refresh_token_enc = excluded.oauth_refresh_token_enc,
         instance_url = excluded.instance_url,
         status = 'active', auth_note = 'reconnected via OAuth'`,
      [state.ws, orgId, state.org_type, state.label, token.instance_url,
       Buffer.from(encryptToken(token.refresh_token), "utf8")]);

    res.send(page("Org connected",
      `${state.label} (${orgId}) is connected. The ingestion worker will pick`
      + " it up on its next poll. You can close this tab."));
  })().catch(next);
});

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;max-width:480px;margin:80px auto;
line-height:1.6"><h2>${title}</h2><p>${body}</p></body>`;
}

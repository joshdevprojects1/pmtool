// Ingestion worker: polls every active org connection on an interval, then
// rescores. Run alongside the API:  npm run worker
//
// Salesforce auth, in order of preference:
//   1. SF_CLI_ALIAS set -> asks the Salesforce CLI for a fresh token on
//      every poll (best dev path: never expires on you; the CLI refreshes
//      its own session). Requires `sf org login web --alias <alias>` once.
//   2. SF_CLIENT_ID + SF_CLIENT_SECRET set and the org has a stored refresh
//      token -> OAuth refresh flow (production path).
//   3. SF_ACCESS_TOKEN + SF_INSTANCE_URL set -> used for every org (manual
//      dev path; tokens from `sf org display` expire after a few hours).

import "dotenv/config";
import { execFile } from "node:child_process";
import { withWorkspace, systemQuery } from "./db.js";
import { scoreChanges } from "./services/linking.js";
import { pollOrg, OrgRow } from "./services/ingestion.js";
import { SfClient, refreshAccessToken, clientCredentialsToken }
  from "./services/salesforce.js";
import { decryptToken } from "./services/crypto.js";

const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000);

function sfJson(args: string[]): Promise<any | null> {
  return new Promise((resolve) => {
    execFile("sf", args,
             { timeout: 30_000, shell: process.platform === "win32" },
             (err: any, stdout: string) => {
      if (err) return resolve(null);
      try {
        const start = stdout.indexOf("{");
        const end = stdout.lastIndexOf("}");
        resolve(JSON.parse(stdout.slice(start, end + 1)).result ?? null);
      } catch { resolve(null); }
    });
  });
}

// A real session token starts with the org id (00D...). Newer sf CLI
// versions REDACT accessToken in `org display` output and provide
// `org auth show-access-token` instead - so try that first, and never
// forward anything that does not look like a token.
function looksLikeToken(t: unknown): t is string {
  return typeof t === "string" && /^00D[a-zA-Z0-9]{9,}!/.test(t.trim());
}

async function cliAuth(alias: string):
    Promise<{ token: string; instanceUrl: string } | null> {
  const shown = await sfJson(
    ["org", "auth", "show-access-token", "--target-org", alias, "--json"]);
  const display = await sfJson(
    ["org", "display", "--target-org", alias, "--json"]);
  const candidates = [shown?.accessToken, shown?.token,
                      typeof shown === "string" ? shown : null,
                      display?.accessToken];
  const token = candidates.find(looksLikeToken);
  const instanceUrl = (shown?.instanceUrl ?? display?.instanceUrl) as
    string | undefined;
  if (!token || !instanceUrl) {
    console.error("[worker] could not obtain a valid access token from the"
      + ` sf CLI for alias ${alias}. org display gave: `
      + String(display?.accessToken ?? "nothing").slice(0, 40));
    return null;
  }
  return { token: token.trim(), instanceUrl: instanceUrl.trim() };
}

async function sfClientFor(org: OrgRow & { oauth_refresh_token_enc?: any }) {
  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;
  // Client credentials: the recommended commercial mode (dedicated
  // integration user as the connected app's run-as user).
  if (org.auth_mode === "client_credentials" && clientId && clientSecret) {
    const token = await clientCredentialsToken(
      org.instance_url, clientId, clientSecret);
    return new SfClient(token, org.instance_url);
  }
  // Per-org OAuth refresh token (web-server flow connections).
  const stored = org.oauth_refresh_token_enc
    ? Buffer.from(org.oauth_refresh_token_enc).toString("utf8") : "";
  if (clientId && clientSecret && stored.includes(".")) {
    try {
      const refreshToken = decryptToken(stored);
      const token = await refreshAccessToken(
        org.instance_url, clientId, clientSecret, refreshToken);
      return new SfClient(token, org.instance_url);
    } catch (err) {
      console.error(`[worker] ${org.label}: OAuth refresh failed, falling`
        + " back to CLI/env auth", err);
    }
  }
  if (process.env.SF_CLI_ALIAS) {
    const auth = await cliAuth(process.env.SF_CLI_ALIAS);
    if (auth) return new SfClient(auth.token, auth.instanceUrl);
    console.error("[worker] sf CLI auth failed for alias"
      + ` ${process.env.SF_CLI_ALIAS} - is the org authorized?`
      + " Try: sf org login web --alias " + process.env.SF_CLI_ALIAS);
    return null;
  }
  if (process.env.SF_ACCESS_TOKEN && process.env.SF_INSTANCE_URL) {
    return new SfClient(process.env.SF_ACCESS_TOKEN,
                        process.env.SF_INSTANCE_URL);
  }
  return null;
}

async function tick() {
  const { rows: orgs } = await systemQuery(
    `select id, workspace_id, auth_mode, label, instance_url, last_synced_at,
            api_budget_daily, api_calls_today, api_calls_date,
            oauth_refresh_token_enc
     from org_connection where status = 'active'`);
  for (const org of orgs as Array<OrgRow & { oauth_refresh_token_enc: any }>) {
    try {
      const sf = await sfClientFor(org);
      if (!sf) {
        console.log(`[worker] ${org.label}: no Salesforce auth configured`
                    + " (see worker.ts header) - skipping");
        continue;
      }
      const result = await withWorkspace(org.workspace_id, async (client) => {
        const poll = await pollOrg(client, org, sf);
        const suggestions = poll.inserted > 0 ? await scoreChanges(client) : 0;
        return { ...poll, suggestions };
      });
      if (result.skipped) {
        console.log(`[worker] ${org.label}: skipped - ${result.skipped}`);
      } else {
        console.log(`[worker] ${org.label}: ${result.source} -> `
          + `${result.fetched} fetched, ${result.inserted} new, `
          + `${result.suggestions} suggestions, ${result.apiCalls} API calls`);
      }
    } catch (err) {
      console.error(`[worker] ${org.label}: poll failed`, err);
    }
  }
}

// Main loop: a full tick every INTERVAL_MS, plus an immediate tick whenever
// the API has stamped poll_requested_at on any active org ("Check now"
// button). The flag is cleared before polling so requests made mid-poll
// queue another round rather than being lost.
const CHECK_MS = 3_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollRequested(): Promise<boolean> {
  const { rows } = await systemQuery(
    `select 1 from org_connection
     where status = 'active' and poll_requested_at is not null limit 1`);
  return rows.length > 0;
}

async function main() {
  console.log(`pmtool ingestion worker: polling every ${INTERVAL_MS / 1000}s`
    + ` (on-demand checks every ${CHECK_MS / 1000}s)`);
  let lastTick = 0;
  for (;;) {
    let run = Date.now() - lastTick >= INTERVAL_MS;
    if (!run) {
      try { run = await pollRequested(); }
      catch (err) { console.error("[worker] flag check failed", err); }
    }
    if (run) {
      lastTick = Date.now();
      try {
        await systemQuery(
          `update org_connection set poll_requested_at = null
           where poll_requested_at is not null`);
        await tick();
      } catch (err) { console.error("[worker] tick failed", err); }
    }
    await sleep(CHECK_MS);
  }
}

main();

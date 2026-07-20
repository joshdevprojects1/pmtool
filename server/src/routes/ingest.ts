import { createHmac, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { withWorkspace, systemQuery } from "../db.js";
import { Problem } from "../problem.js";
import { scoreChanges } from "../services/linking.js";

export const ingest = Router();

// org_connection uuid -> shared secret, from INGEST_SECRETS="uuid:secret,..."
const secrets = new Map<string, string>(
  (process.env.INGEST_SECRETS ?? "").split(",").filter(Boolean).map((pair) => {
    const idx = pair.indexOf(":");
    return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()] as
      [string, string];
  }),
);

interface IngestComponent {
  component_type: string;
  api_name: string;
  operation?: string;
}

// Raw body so the HMAC covers exactly the bytes that were sent.
ingest.post("/deployments", express.raw({ type: "*/*" }), (req, res, next) => {
  (async () => {
    const raw: Buffer = req.body ?? Buffer.alloc(0);
    let body: any;
    try { body = JSON.parse(raw.toString("utf8")); }
    catch { throw new Problem(400, "Invalid JSON"); }

    const secret = secrets.get(String(body.org_id ?? ""));
    if (!secret) throw new Problem(401, "Unknown org");
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const given = Buffer.from(String(req.headers["x-signature"] ?? ""));
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(want, given)) {
      throw new Problem(401, "Bad signature",
        "X-Signature must be hex(hmac-sha256(raw body, org secret))");
    }
    for (const f of ["external_ref", "components", "deployed_at"]) {
      if (!(f in body)) {
        throw new Problem(422, "Validation failed", `${f} is required`);
      }
    }

    // No bearer token on this path: the org connection resolves the tenant.
    const { rows: [org] } = await systemQuery(
      "select id, workspace_id from org_connection where id = $1",
      [body.org_id]);
    if (!org) throw new Problem(401, "Unknown org");

    const result = await withWorkspace(org.workspace_id, async (client) => {
      const { rows: [dep] } = await client.query(
        `insert into deployment (workspace_id, org_connection_id, external_ref,
           commit_sha, commit_message, deployed_by, deployed_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (org_connection_id, external_ref) do nothing
         returning id`,
        [org.workspace_id, org.id, body.external_ref, body.commit_sha ?? null,
         body.commit_message ?? null, body.deployed_by ?? null,
         body.deployed_at]);
      if (!dep) return { status: "duplicate ignored (idempotent)" };

      for (const comp of body.components as IngestComponent[]) {
        const { rows: [c] } = await client.query(
          `insert into component (workspace_id, component_type, api_name)
           values ($1, $2, $3)
           on conflict (workspace_id, component_type, api_name)
             do update set api_name = excluded.api_name
           returning id`,
          [org.workspace_id, comp.component_type, comp.api_name]);
        await client.query(
          `insert into deployment_component (deployment_id, component_id)
           values ($1, $2) on conflict do nothing`, [dep.id, c.id]);
        await client.query(
          `insert into change_event (workspace_id, org_connection_id,
             component_id, operation, author_username, occurred_at, source,
             source_ref)
           values ($1, $2, $3, $4, $5, $6, 'cicd', $7)
           on conflict (org_connection_id, component_id, occurred_at, source)
             do nothing`,
          [org.workspace_id, org.id, c.id, comp.operation ?? "update",
           body.deployed_by ?? "ci", body.deployed_at, String(dep.id)]);
      }
      const created = await scoreChanges(client);
      return { status: "accepted", deployment_id: dep.id,
               suggestions_created: created };
    });
    res.status(202).json(result);
  })().catch(next);
});

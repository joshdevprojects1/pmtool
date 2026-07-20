import { Router } from "express";
import { withWorkspace } from "../db.js";

export const changes = Router();

changes.get("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const params: unknown[] = [];
    let where = " where true";
    const filters: Array<[string, string]> = [
      ["org_id", "ce.org_connection_id"], ["component_id", "ce.component_id"],
      ["author", "ce.author_username"], ["source", "ce.source"]];
    for (const [q, col] of filters) {
      if (req.query[q]) {
        params.push(req.query[q]);
        where += ` and ${col} = $${params.length}`;
      }
    }
    if (req.query.since) {
      params.push(req.query.since);
      where += ` and ce.occurred_at >= $${params.length}`;
    }
    if (req.query.cursor) {
      params.push(req.query.cursor);
      where += ` and ce.occurred_at < $${params.length}`;
    }
    params.push(limit);
    const { rows } = await client.query(
      `select ce.id, ce.operation, ce.author_username, ce.occurred_at,
              ce.source, ce.source_ref, oc.label as org,
              c.component_type, c.api_name
       from change_event ce
       join component c on c.id = ce.component_id
       join org_connection oc on oc.id = ce.org_connection_id
       ${where} order by ce.occurred_at desc limit $${params.length}`, params);
    res.json({ data: rows,
               next_cursor: rows.length === limit
                 ? rows[rows.length - 1].occurred_at : null });
  }).catch(next);
});

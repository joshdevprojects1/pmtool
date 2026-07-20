import { Router } from "express";
import { withWorkspace } from "../db.js";

export const components = Router();

components.get("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const params: unknown[] = [];
    let where = " where true";
    if (req.query.type) {
      params.push(req.query.type);
      where += ` and component_type = $${params.length}`;
    }
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      where += ` and (api_name ilike $${params.length})`;
    }
    params.push(limit);
    const { rows } = await client.query(
      `select id, component_type, api_name, label, first_seen_at
       from component ${where} order by component_type, api_name
       limit $${params.length}`, params);
    res.json({ data: rows, next_cursor: null });
  }).catch(next);
});

components.get("/:id/changes", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const { rows } = await client.query(
      `select ce.id, ce.operation, ce.author_username, ce.occurred_at,
              ce.source, oc.label as org
       from change_event ce
       join org_connection oc on oc.id = ce.org_connection_id
       where ce.component_id = $1 order by ce.occurred_at`, [req.params.id]);
    res.json({ data: rows });
  }).catch(next);
});

components.get("/:id/links", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const { rows } = await client.query(
      `select component_id, entity_type, entity_id, origin, created_at
       from component_link where component_id = $1`, [req.params.id]);
    res.json({ data: rows });
  }).catch(next);
});

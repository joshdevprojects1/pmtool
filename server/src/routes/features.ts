import { Router } from "express";
import { withWorkspace } from "../db.js";
import { Problem } from "../problem.js";
import type { Client } from "../db.js";

export const features = Router();

const FEATURE_SQL = `
  select f.id, f.project_id, f.name, f.description, f.status, f.sort_order,
         f.created_at,
         (select count(*)::int from ticket_feature tf
          where tf.feature_id = f.id) as ticket_count
  from feature f`;

async function loadFeature(client: Client, id: string) {
  const { rows: [f] } = await client.query(
    `${FEATURE_SQL} where f.id = $1`, [id]);
  if (!f) throw new Problem(404, "Not found", `no feature ${id}`);
  return f;
}

features.get("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const params: unknown[] = [];
    let where = " where true";
    for (const f of ["status", "project_id"] as const) {
      if (req.query[f]) {
        params.push(req.query[f]);
        where += ` and f.${f} = $${params.length}`;
      }
    }
    const { rows } = await client.query(
      `${FEATURE_SQL} ${where} order by f.sort_order, f.created_at`, params);
    res.json({ data: rows, next_cursor: null });
  }).catch(next);
});

features.post("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const { project_id, name, description } = req.body ?? {};
    if (!name) throw new Problem(422, "Validation failed", "name is required");
    const { rows: [proj] } = await client.query(
      project_id ? "select id from project where id = $1"
                 : "select id from project order by created_at limit 1",
      project_id ? [project_id] : []);
    if (!proj) throw new Problem(422, "Validation failed", "no project");
    const { rows: [f] } = await client.query(
      `insert into feature (workspace_id, project_id, name, description)
       values (current_setting('app.workspace_id')::uuid, $1, $2, $3)
       returning id`,
      [proj.id, name, description ?? null]);
    res.status(201).json(await loadFeature(client, f.id));
  }).catch(next);
});

features.get("/:id", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    res.json(await loadFeature(client, req.params.id));
  }).catch(next);
});

features.patch("/:id", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    await loadFeature(client, req.params.id);
    for (const f of ["name", "description", "status",
                     "sort_order"] as const) {
      if (f in (req.body ?? {})) {
        await client.query(
          `update feature set ${f} = $1 where id = $2`,
          [req.body[f], req.params.id]);
      }
    }
    res.json(await loadFeature(client, req.params.id));
  }).catch(next);
});

// Tickets linked to this feature (same shape as /v1/tickets rows).
features.get("/:id/tickets", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    await loadFeature(client, req.params.id);
    const { rows } = await client.query(
      `select t.id, p.key || '-' || t.number as key, t.title, t.status,
              t.priority, t.assignee_id, t.updated_at
       from ticket_feature tf
       join ticket t on t.id = tf.ticket_id
       join project p on p.id = t.project_id
       where tf.feature_id = $1
       order by t.status, t.updated_at desc`, [req.params.id]);
    res.json({ data: rows });
  }).catch(next);
});

features.get("/:id/components", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const { rows } = await client.query(
      `select c.id, c.component_type, c.api_name, cl.origin,
              (select json_build_object(
                 'occurred_at', ce.occurred_at,
                 'author_username', ce.author_username,
                 'operation', ce.operation,
                 'org_id', ce.org_connection_id)
               from change_event ce where ce.component_id = c.id
               order by ce.occurred_at desc limit 1) as last_change,
              (select array_agg(distinct oc.label)
               from change_event ce join org_connection oc
                 on oc.id = ce.org_connection_id
               where ce.component_id = c.id) as orgs_seen
       from component_link cl
       join component c on c.id = cl.component_id
       where cl.entity_type = 'feature' and cl.entity_id = $1
       order by c.component_type, c.api_name`, [req.params.id]);
    res.json({ data: rows });
  }).catch(next);
});

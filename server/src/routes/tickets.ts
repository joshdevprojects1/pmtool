import { Router } from "express";
import { withWorkspace } from "../db.js";
import { Problem } from "../problem.js";
import type { Client } from "../db.js";

export const tickets = Router();

const TICKET_SQL = `
  select t.id, p.key || '-' || t.number as key, t.title, t.description,
         t.status, t.priority, t.assignee_id, t.created_at, t.updated_at,
         coalesce((select json_agg(json_build_object('id', f.id, 'name', f.name)
                          order by f.name)
                   from ticket_feature tf
                   join feature f on f.id = tf.feature_id
                   where tf.ticket_id = t.id), '[]'::json) as features
  from ticket t join project p on p.id = t.project_id`;

async function loadTicket(client: Client, id: string) {
  const { rows: [t] } = await client.query(
    `${TICKET_SQL} where t.id = $1`, [id]);
  if (!t) throw new Problem(404, "Not found", `no ticket ${id}`);
  return t;
}

// Validate feature ids exist in this ticket's project; throws 422 otherwise.
async function checkFeatures(client: Client, projectId: string,
                             featureIds: string[]) {
  if (featureIds.length === 0) return;
  const { rows } = await client.query(
    "select id from feature where project_id = $1 and id = any($2::uuid[])",
    [projectId, featureIds]);
  if (rows.length !== new Set(featureIds).size) {
    throw new Problem(422, "Validation failed",
                      "one or more features not found in this project");
  }
}

tickets.get("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const params: unknown[] = [];
    let where = " where true";
    for (const f of ["status", "assignee_id"] as const) {
      if (req.query[f]) {
        params.push(req.query[f]);
        where += ` and t.${f} = $${params.length}`;
      }
    }
    if (req.query.feature_id) {
      params.push(req.query.feature_id);
      where += ` and exists (select 1 from ticket_feature tf
                             where tf.ticket_id = t.id
                               and tf.feature_id = $${params.length})`;
    }
    if (req.query.cursor) {
      params.push(req.query.cursor);
      where += ` and t.id > $${params.length}`;
    }
    params.push(limit);
    const { rows } = await client.query(
      `${TICKET_SQL} ${where} order by t.id limit $${params.length}`, params);
    res.json({ data: rows,
               next_cursor: rows.length === limit ? rows[rows.length - 1].id : null });
  }).catch(next);
});

tickets.post("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const { project_id, feature_id, feature_ids, title, description,
            assignee_id } = req.body ?? {};
    if (!title) throw new Problem(422, "Validation failed", "title is required");
    const { rows: [proj] } = await client.query(
      project_id ? "select id from project where id = $1"
                 : "select id from project order by created_at limit 1",
      project_id ? [project_id] : []);
    if (!proj) throw new Problem(422, "Validation failed", "no project");
    const fids: string[] =
      Array.isArray(feature_ids) ? feature_ids
      : feature_id ? [feature_id] : [];
    await checkFeatures(client, proj.id, fids);
    const { rows: [t] } = await client.query(
      `insert into ticket (workspace_id, project_id, number, title,
         description, assignee_id, started_at, finished_at)
       values (current_setting('app.workspace_id')::uuid, $1,
         (select coalesce(max(number), 0) + 1 from ticket where project_id = $1),
         $2, $3, $4, now(), now() + interval '7 days')
       returning id`,
      [proj.id, title, description ?? null, assignee_id ?? null]);
    for (const fid of new Set(fids)) {
      await client.query(
        `insert into ticket_feature (workspace_id, ticket_id, feature_id)
         values (current_setting('app.workspace_id')::uuid, $1, $2)`,
        [t.id, fid]);
    }
    res.status(201).json(await loadTicket(client, t.id));
  }).catch(next);
});

tickets.get("/:id", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    res.json(await loadTicket(client, req.params.id));
  }).catch(next);
});

tickets.patch("/:id", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const t = await loadTicket(client, req.params.id);
    for (const f of ["title", "description", "status", "assignee_id",
                     "priority"] as const) {
      if (f in (req.body ?? {})) {
        await client.query(
          `update ticket set ${f} = $1, updated_at = now() where id = $2`,
          [req.body[f], req.params.id]);
      }
    }
    // feature_ids = full replace of the linked-feature set.
    if (Array.isArray(req.body?.feature_ids)) {
      const { rows: [{ project_id }] } = await client.query(
        "select project_id from ticket where id = $1", [t.id]);
      const fids: string[] = [...new Set<string>(req.body.feature_ids)];
      await checkFeatures(client, project_id, fids);
      await client.query(
        `delete from ticket_feature where ticket_id = $1
         and feature_id <> all($2::uuid[])`, [t.id, fids]);
      for (const fid of fids) {
        await client.query(
          `insert into ticket_feature (workspace_id, ticket_id, feature_id)
           values (current_setting('app.workspace_id')::uuid, $1, $2)
           on conflict do nothing`, [t.id, fid]);
      }
    }
    res.json(await loadTicket(client, req.params.id));
  }).catch(next);
});

// --- ticket <-> feature links -----------------------------------------------

tickets.post("/:id/features", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const fid = req.body?.feature_id;
    if (!fid) throw new Problem(422, "Validation failed",
                                "feature_id is required");
    await loadTicket(client, req.params.id);
    const { rows: [{ project_id }] } = await client.query(
      "select project_id from ticket where id = $1", [req.params.id]);
    await checkFeatures(client, project_id, [fid]);
    const { rowCount } = await client.query(
      `insert into ticket_feature (workspace_id, ticket_id, feature_id)
       values (current_setting('app.workspace_id')::uuid, $1, $2)
       on conflict do nothing`, [req.params.id, fid]);
    if (!rowCount) throw new Problem(409, "Already linked");
    res.status(201).json(await loadTicket(client, req.params.id));
  }).catch(next);
});

tickets.delete("/:id/features/:featureId", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    await client.query(
      "delete from ticket_feature where ticket_id = $1 and feature_id = $2",
      [req.params.id, req.params.featureId]);
    res.status(204).end();
  }).catch(next);
});

// --- ticket <-> change links ------------------------------------------------

tickets.get("/:id/changes", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const { rows } = await client.query(
      `select tc.ticket_id, tc.origin, tc.created_at,
              ce.id as change_event_id, ce.operation, ce.author_username,
              ce.occurred_at, ce.source, c.component_type, c.api_name
       from ticket_change tc
       join change_event ce on ce.id = tc.change_event_id
         and ce.occurred_at = tc.change_occurred_at
       join component c on c.id = ce.component_id
       where tc.ticket_id = $1 order by ce.occurred_at`, [req.params.id]);
    res.json({ data: rows });
  }).catch(next);
});

tickets.post("/:id/changes", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const evId = req.body?.change_event_id;
    if (!evId) throw new Problem(422, "Validation failed",
                                 "change_event_id is required");
    const { rows: [ev] } = await client.query(
      "select id, occurred_at, component_id from change_event where id = $1",
      [evId]);
    if (!ev) throw new Problem(422, "Validation failed", "unknown change event");
    const { rowCount } = await client.query(
      `insert into ticket_change (workspace_id, ticket_id, change_event_id,
         change_occurred_at, origin)
       values (current_setting('app.workspace_id')::uuid, $1, $2, $3, 'manual')
       on conflict do nothing`,
      [req.params.id, ev.id, ev.occurred_at]);
    if (!rowCount) throw new Problem(409, "Already linked");
    await client.query(
      `insert into component_link (workspace_id, component_id, entity_type,
         entity_id, origin)
       select current_setting('app.workspace_id')::uuid, $1, 'feature',
              tf.feature_id, 'manual'
       from ticket_feature tf where tf.ticket_id = $2
       on conflict (component_id, entity_type, entity_id) do nothing`,
      [ev.component_id, req.params.id]);
    res.status(201).json({ ticket_id: req.params.id,
                           change_event_id: ev.id, origin: "manual" });
  }).catch(next);
});

tickets.delete("/:id/changes/:eventId", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    await client.query(
      "delete from ticket_change where ticket_id = $1 and change_event_id = $2",
      [req.params.id, req.params.eventId]);
    res.status(204).end();
  }).catch(next);
});

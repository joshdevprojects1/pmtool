import { Router } from "express";
import { withWorkspace } from "../db.js";
import { Problem } from "../problem.js";
import type { Client } from "../db.js";

export const sprints = Router();

const SPRINT_SQL = `
  select s.id, s.project_id, s.name, s.goal, s.starts_on, s.ends_on,
         s.status, s.created_at,
         (select count(*) from ticket t
          where t.sprint_id = s.id)::int as ticket_count,
         (select count(*) from ticket t
          where t.sprint_id = s.id and t.status = 'done')::int as done_count
  from sprint s`;

async function loadSprint(client: Client, id: string) {
  const { rows: [s] } = await client.query(
    `${SPRINT_SQL} where s.id = $1`, [id]);
  if (!s) throw new Problem(404, "Not found", `no sprint ${id}`);
  return s;
}

sprints.get("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const params: unknown[] = [];
    let where = " where true";
    if (req.query.status) {
      params.push(req.query.status);
      where += ` and s.status = $${params.length}`;
    }
    const { rows } = await client.query(
      `${SPRINT_SQL} ${where}
       order by case s.status when 'active' then 0
                              when 'planned' then 1 else 2 end,
                s.starts_on desc nulls last, s.created_at desc`, params);
    res.json({ data: rows });
  }).catch(next);
});

sprints.post("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const { project_id, name, goal, starts_on, ends_on } = req.body ?? {};
    if (!name?.trim()) {
      throw new Problem(422, "Validation failed", "name is required");
    }
    const { rows: [proj] } = await client.query(
      project_id ? "select id from project where id = $1"
                 : "select id from project order by created_at limit 1",
      project_id ? [project_id] : []);
    if (!proj) throw new Problem(422, "Validation failed", "no project");
    const { rows: [s] } = await client.query(
      `insert into sprint (workspace_id, project_id, name, goal,
                           starts_on, ends_on)
       values (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4, $5)
       returning id`,
      [proj.id, name.trim(), goal ?? null, starts_on ?? null, ends_on ?? null]);
    res.status(201).json(await loadSprint(client, s.id));
  }).catch(next);
});

sprints.patch("/:id", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    await loadSprint(client, req.params.id);
    if (req.body?.status
        && !["planned", "active", "completed"].includes(req.body.status)) {
      throw new Problem(422, "Validation failed", "invalid status");
    }
    for (const f of ["name", "goal", "starts_on", "ends_on",
                     "status"] as const) {
      if (f in (req.body ?? {})) {
        await client.query(
          `update sprint set ${f} = $1 where id = $2`,
          [req.body[f], req.params.id]);
      }
    }
    // Completing a sprint sends its unfinished tickets back to the backlog.
    if (req.body?.status === "completed") {
      await client.query(
        `update ticket set sprint_id = null, updated_at = now()
         where sprint_id = $1 and status <> 'done'`, [req.params.id]);
    }
    res.json(await loadSprint(client, req.params.id));
  }).catch(next);
});

sprints.delete("/:id", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    await loadSprint(client, req.params.id);
    await client.query(
      "update ticket set sprint_id = null where sprint_id = $1",
      [req.params.id]);
    await client.query("delete from sprint where id = $1", [req.params.id]);
    res.status(204).end();
  }).catch(next);
});

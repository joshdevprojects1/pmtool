import { Router } from "express";
import { withWorkspace } from "../db.js";

export const search = Router();

// GET /v1/search?q= — grouped cross-entity search for the header search box.
search.get("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      res.json({ tickets: [], features: [], components: [] });
      return;
    }
    const like = `%${q}%`;
    const [tickets, features, components] = await Promise.all([
      client.query(
        `select t.id, p.key || '-' || t.number as key, t.title, t.status
         from ticket t join project p on p.id = t.project_id
         where t.title ilike $1 or t.description ilike $1
            or p.key || '-' || t.number ilike $1
         order by t.updated_at desc limit 8`, [like]),
      client.query(
        `select id, name, status from feature
         where name ilike $1 or description ilike $1
         order by name limit 5`, [like]),
      client.query(
        `select id, component_type, api_name from component
         where api_name ilike $1 or component_type ilike $1
         order by api_name limit 5`, [like]),
    ]);
    res.json({ tickets: tickets.rows, features: features.rows,
               components: components.rows });
  }).catch(next);
});

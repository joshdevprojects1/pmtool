import { Router } from "express";
import { withWorkspace } from "../db.js";
import { Problem } from "../problem.js";
import { acceptSuggestion } from "../services/linking.js";

export const suggestions = Router();

const SUGG_SQL = `
  select ls.id, ls.ticket_id, ls.score, ls.signals, ls.status,
         ce.id as change_event_id, ce.operation, ce.author_username,
         ce.occurred_at, ce.source, c.component_type, c.api_name
  from link_suggestion ls
  join change_event ce on ce.id = ls.change_event_id
    and ce.occurred_at = ls.change_occurred_at
  join component c on c.id = ce.component_id`;

suggestions.get("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const params: unknown[] = [String(req.query.status ?? "pending")];
    let where = " where ls.status = $1";
    if (req.query.ticket_id) {
      params.push(req.query.ticket_id);
      where += ` and ls.ticket_id = $${params.length}`;
    }
    if (req.query.min_score) {
      params.push(Number(req.query.min_score));
      where += ` and ls.score >= $${params.length}`;
    }
    params.push(limit);
    const { rows } = await client.query(
      `${SUGG_SQL} ${where} order by ls.score desc, ls.created_at
       limit $${params.length}`, params);
    res.json({ data: rows, next_cursor: null });
  }).catch(next);
});

suggestions.post("/:id/accept", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const s = await acceptSuggestion(client, req.params.id);
    if (!s) throw new Problem(409, "Already resolved",
                              "suggestion is not pending");
    res.json({ ticket_id: s.ticket_id, change_event_id: s.change_event_id,
               origin: "suggestion" });
  }).catch(next);
});

suggestions.post("/:id/reject", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const { rows: [s] } = await client.query(
      `update link_suggestion set status = 'rejected', resolved_at = now()
       where id = $1 and status = 'pending' returning id, status`,
      [req.params.id]);
    if (!s) throw new Problem(409, "Already resolved",
                              "suggestion is not pending");
    res.json(s);
  }).catch(next);
});

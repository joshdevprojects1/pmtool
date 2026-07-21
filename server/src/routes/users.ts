import { Router } from "express";
import { withWorkspace } from "../db.js";
import { Problem } from "../problem.js";
import { newSessionToken } from "../services/passwords.js";
import { requireAdmin } from "./invites.js";

export const users = Router();

const USER_COLS = "id, email, display_name, role, sf_usernames, created_at";

// GET /v1/users — everyone in the workspace (for assignee pickers etc.)
users.get("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    const { rows } = await client.query(
      `select ${USER_COLS} from app_user order by display_name`);
    res.json({ data: rows });
  }).catch(next);
});

// PATCH /v1/users/me — edit own profile (session-authed only).
users.patch("/me", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    if (!req.userId) {
      throw new Problem(403, "Forbidden",
                        "profile editing requires a user session");
    }
    const { display_name, sf_usernames } = req.body ?? {};
    if (display_name !== undefined) {
      if (!String(display_name).trim()) {
        throw new Problem(422, "Validation failed",
                          "display_name cannot be empty");
      }
      await client.query(
        "update app_user set display_name = $1 where id = $2",
        [String(display_name).trim(), req.userId]);
    }
    if (sf_usernames !== undefined) {
      if (!Array.isArray(sf_usernames)
          || sf_usernames.some((u) => typeof u !== "string")) {
        throw new Problem(422, "Validation failed",
                          "sf_usernames must be an array of strings");
      }
      await client.query(
        "update app_user set sf_usernames = $1 where id = $2",
        [sf_usernames.map((u: string) => u.trim()).filter(Boolean),
         req.userId]);
    }
    const { rows: [u] } = await client.query(
      `select ${USER_COLS} from app_user where id = $1`, [req.userId]);
    res.json(u);
  }).catch(next);
});

// POST /v1/users/:id/reset-link — admin-only; returns a one-time reset
// token (24h) for out-of-band delivery. No email infrastructure.
users.post("/:id/reset-link", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    await requireAdmin(client, req);
    const { rows: [target] } = await client.query(
      "select id, email from app_user where id = $1", [req.params.id]);
    if (!target) throw new Problem(404, "Not found", "no such user");
    const { token, tokenHash } = newSessionToken();
    await client.query(
      `insert into password_reset (token_hash, user_id, created_by,
                                   expires_at)
       values ($1, $2, $3, now() + interval '24 hours')`,
      [tokenHash, target.id, req.userId ?? null]);
    res.status(201).json({ user_id: target.id, email: target.email, token,
                           expires_in_hours: 24 });
  }).catch(next);
});

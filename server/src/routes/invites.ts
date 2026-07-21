import { Router } from "express";
import { withWorkspace } from "../db.js";
import { Problem } from "../problem.js";
import { newSessionToken } from "../services/passwords.js";
import type { Client } from "../db.js";
import type { Request } from "express";

export const invites = Router();

const INVITE_DAYS = 14;

// Bearer (machine) tokens already have full workspace access; session
// users must be admins.
export async function requireAdmin(client: Client, req: Request) {
  if (!req.userId) return;
  const { rows: [u] } = await client.query(
    "select role from app_user where id = $1", [req.userId]);
  if (u?.role !== "admin") {
    throw new Problem(403, "Forbidden", "admin role required");
  }
}

// GET /v1/invites — open invites for the workspace.
invites.get("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    await requireAdmin(client, req);
    const { rows } = await client.query(
      `select i.id, i.email, i.role, i.created_at, i.expires_at,
              u.display_name as invited_by_name
       from workspace_invite i
       left join app_user u on u.id = i.invited_by
       where i.accepted_at is null and i.expires_at > now()
       order by i.created_at desc`);
    res.json({ data: rows });
  }).catch(next);
});

// POST /v1/invites { email, role } — returns the invite token ONCE; the
// caller builds the link and delivers it (no email infrastructure).
invites.post("/", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    await requireAdmin(client, req);
    const { email, role } = req.body ?? {};
    if (!email?.trim()) {
      throw new Problem(422, "Validation failed", "email is required");
    }
    if (role && !["admin", "member", "viewer"].includes(role)) {
      throw new Problem(422, "Validation failed", "invalid role");
    }
    const { rows: [existing] } = await client.query(
      "select password_hash from app_user where email = $1",
      [email.trim()]);
    if (existing?.password_hash) {
      throw new Problem(409, "Conflict",
                        "that email already has an account in this workspace");
    }
    // One live invite per email: replace any open one.
    await client.query(
      `delete from workspace_invite
       where email = $1 and accepted_at is null`, [email.trim()]);
    const { token, tokenHash } = newSessionToken();
    const { rows: [inv] } = await client.query(
      `insert into workspace_invite (workspace_id, email, role, token_hash,
                                     invited_by, expires_at)
       values (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4,
               now() + interval '${INVITE_DAYS} days')
       returning id, email, role, created_at, expires_at`,
      [email.trim(), role ?? "member", tokenHash, req.userId ?? null]);
    res.status(201).json({ ...inv, token });
  }).catch(next);
});

// DELETE /v1/invites/:id — revoke.
invites.delete("/:id", (req, res, next) => {
  withWorkspace(req.workspaceId, async (client) => {
    await requireAdmin(client, req);
    await client.query(
      "delete from workspace_invite where id = $1 and accepted_at is null",
      [req.params.id]);
    res.status(204).end();
  }).catch(next);
});

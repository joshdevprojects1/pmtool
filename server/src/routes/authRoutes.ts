import { Router } from "express";
import { systemQuery, withWorkspace } from "../db.js";
import { Problem } from "../problem.js";
import { hashPassword, verifyPassword, newSessionToken, sha256 }
  from "../services/passwords.js";
import { SESSION_COOKIE, readSessionToken } from "../auth.js";

export const authRoutes = Router();

const SESSION_DAYS = 30;

const USER_COLS =
  "id, workspace_id, email, display_name, role, sf_usernames";

function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

async function createSession(userId: string, workspaceId: string) {
  const { token, tokenHash } = newSessionToken();
  await systemQuery(
    `insert into user_session (token_hash, workspace_id, user_id, expires_at)
     values ($1, $2, $3, now() + interval '${SESSION_DAYS} days')`,
    [tokenHash, workspaceId, userId]);
  // Opportunistic cleanup of expired sessions and resets.
  await systemQuery("delete from user_session where expires_at < now()");
  await systemQuery("delete from password_reset where expires_at < now()");
  return token;
}

function publicUser(u: Record<string, unknown>) {
  const { id, workspace_id, email, display_name, role, sf_usernames } = u;
  return { id, workspace_id, email, display_name, role, sf_usernames };
}

async function currentSession(req: import("express").Request) {
  const token = readSessionToken(req);
  if (!token) throw new Problem(401, "Unauthorized", "no session");
  const { rows: [session] } = await systemQuery(
    `select user_id, workspace_id, token_hash from user_session
     where token_hash = $1 and expires_at > now()`, [sha256(token)]);
  if (!session) throw new Problem(401, "Unauthorized", "session expired");
  return session as { user_id: string; workspace_id: string;
                      token_hash: string };
}

// POST /v1/auth/login { email, password }
authRoutes.post("/login", (req, res, next) => {
  (async () => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      throw new Problem(422, "Validation failed",
                        "email and password are required");
    }
    const { rows: [user] } = await systemQuery(
      `select ${USER_COLS}, password_hash from app_user
       where email = $1 order by created_at limit 1`, [email]);
    if (!user?.password_hash
        || !verifyPassword(password, user.password_hash)) {
      throw new Problem(401, "Unauthorized", "invalid email or password");
    }
    const token = await createSession(user.id, user.workspace_id);
    setSessionCookie(res, token);
    res.json(publicUser(user));
  })().catch(next);
});

// GET /v1/auth/invite/:token — public preview so the register form can
// show what is being joined.
authRoutes.get("/invite/:token", (req, res, next) => {
  (async () => {
    const { rows: [inv] } = await systemQuery(
      `select i.email, i.role, w.name as workspace_name
       from workspace_invite i join workspace w on w.id = i.workspace_id
       where i.token_hash = $1 and i.accepted_at is null
         and i.expires_at > now()`, [sha256(req.params.token)]);
    if (!inv) {
      throw new Problem(404, "Not found", "invite is invalid or expired");
    }
    res.json(inv);
  })().catch(next);
});

// POST /v1/auth/register
//   { email, password, display_name, invite_token?, workspace_name? }
// Three paths:
//   1. invite_token  -> join the inviting workspace with the invited role.
//   2. unclaimed email (seeded/pre-provisioned, no password) -> claim it.
//   3. otherwise     -> create a NEW workspace and become its admin.
authRoutes.post("/register", (req, res, next) => {
  (async () => {
    const { email, password, display_name, invite_token, workspace_name } =
      req.body ?? {};
    if (!password || String(password).length < 8) {
      throw new Problem(422, "Validation failed",
                        "password must be at least 8 characters");
    }
    let user;

    if (invite_token) {
      const { rows: [inv] } = await systemQuery(
        `select id, workspace_id, email, role from workspace_invite
         where token_hash = $1 and accepted_at is null
           and expires_at > now()`, [sha256(invite_token)]);
      if (!inv) {
        throw new Problem(422, "Validation failed",
                          "invite is invalid or expired");
      }
      if (email && String(email).toLowerCase()
          !== String(inv.email).toLowerCase()) {
        throw new Problem(422, "Validation failed",
                          "this invite was issued for a different email");
      }
      const { rows: [existing] } = await systemQuery(
        `select id, password_hash from app_user
         where workspace_id = $1 and email = $2`, [inv.workspace_id, inv.email]);
      if (existing?.password_hash) {
        throw new Problem(409, "Conflict",
                          "an account with this email already exists here");
      }
      if (existing) {
        ({ rows: [user] } = await systemQuery(
          `update app_user set password_hash = $1,
                  display_name = coalesce($2, display_name), role = $3
           where id = $4 returning ${USER_COLS}`,
          [hashPassword(password), display_name ?? null, inv.role,
           existing.id]));
      } else {
        ({ rows: [user] } = await systemQuery(
          `insert into app_user (workspace_id, email, display_name, role,
                                 password_hash)
           values ($1, $2, $3, $4, $5) returning ${USER_COLS}`,
          [inv.workspace_id, inv.email,
           display_name || String(inv.email).split("@")[0], inv.role,
           hashPassword(password)]));
      }
      await systemQuery(
        "update workspace_invite set accepted_at = now() where id = $1",
        [inv.id]);
    } else {
      if (!email) {
        throw new Problem(422, "Validation failed", "email is required");
      }
      const { rows: [existing] } = await systemQuery(
        "select id, password_hash from app_user where email = $1 "
        + "order by created_at limit 1", [email]);
      if (existing && !existing.password_hash) {
        // Claim a pre-provisioned account.
        ({ rows: [user] } = await systemQuery(
          `update app_user set password_hash = $1,
                  display_name = coalesce($2, display_name)
           where id = $3 returning ${USER_COLS}`,
          [hashPassword(password), display_name ?? null, existing.id]));
      } else if (existing) {
        throw new Problem(409, "Conflict",
                          "an account with this email already exists - "
                          + "sign in, or ask for an invite to join another "
                          + "workspace");
      } else {
        // Brand-new signup: their own workspace, admin role, and a default
        // project so ticket creation works immediately.
        const name = display_name || String(email).split("@")[0];
        const { rows: [ws] } = await systemQuery(
          "insert into workspace (name) values ($1) returning id",
          [workspace_name?.trim() || `${name}'s workspace`]);
        await systemQuery(
          `insert into project (workspace_id, key, name)
           values ($1, 'PROJ', 'General')`, [ws.id]);
        ({ rows: [user] } = await systemQuery(
          `insert into app_user (workspace_id, email, display_name, role,
                                 password_hash)
           values ($1, $2, $3, 'admin', $4) returning ${USER_COLS}`,
          [ws.id, email, name, hashPassword(password)]));
      }
    }

    const token = await createSession(user.id, user.workspace_id);
    setSessionCookie(res, token);
    res.status(201).json(publicUser(user));
  })().catch(next);
});

// POST /v1/auth/password { current_password, new_password } — logged-in
// change; revokes every other session for the user.
authRoutes.post("/password", (req, res, next) => {
  (async () => {
    const session = await currentSession(req);
    const { current_password, new_password } = req.body ?? {};
    if (!new_password || String(new_password).length < 8) {
      throw new Problem(422, "Validation failed",
                        "new password must be at least 8 characters");
    }
    const { rows: [user] } = await systemQuery(
      "select password_hash from app_user where id = $1", [session.user_id]);
    if (!user?.password_hash
        || !verifyPassword(current_password ?? "", user.password_hash)) {
      throw new Problem(401, "Unauthorized", "current password is incorrect");
    }
    await systemQuery(
      "update app_user set password_hash = $1 where id = $2",
      [hashPassword(new_password), session.user_id]);
    await systemQuery(
      "delete from user_session where user_id = $1 and token_hash <> $2",
      [session.user_id, session.token_hash]);
    res.status(204).end();
  })().catch(next);
});

// POST /v1/auth/reset { token, password } — complete a reset link; logs
// the user in and revokes all previous sessions.
authRoutes.post("/reset", (req, res, next) => {
  (async () => {
    const { token: resetToken, password } = req.body ?? {};
    if (!resetToken || !password || String(password).length < 8) {
      throw new Problem(422, "Validation failed",
                        "token and a password of at least 8 characters "
                        + "are required");
    }
    const { rows: [reset] } = await systemQuery(
      `select r.token_hash, r.user_id, u.workspace_id
       from password_reset r join app_user u on u.id = r.user_id
       where r.token_hash = $1 and r.used_at is null
         and r.expires_at > now()`, [sha256(resetToken)]);
    if (!reset) {
      throw new Problem(422, "Validation failed",
                        "reset link is invalid or expired");
    }
    await systemQuery(
      "update app_user set password_hash = $1 where id = $2",
      [hashPassword(password), reset.user_id]);
    await systemQuery(
      "update password_reset set used_at = now() where token_hash = $1",
      [reset.token_hash]);
    await systemQuery(
      "delete from user_session where user_id = $1", [reset.user_id]);
    const token = await createSession(reset.user_id, reset.workspace_id);
    setSessionCookie(res, token);
    const { rows: [user] } = await systemQuery(
      `select ${USER_COLS} from app_user where id = $1`, [reset.user_id]);
    res.json(publicUser(user));
  })().catch(next);
});

// POST /v1/auth/logout
authRoutes.post("/logout", (req, res, next) => {
  (async () => {
    const token = readSessionToken(req);
    if (token) {
      await systemQuery("delete from user_session where token_hash = $1",
                        [sha256(token)]);
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  })().catch(next);
});

// GET /v1/auth/me — who am I (session only; bearer clients know already).
authRoutes.get("/me", (req, res, next) => {
  (async () => {
    const session = await currentSession(req);
    const user = await withWorkspace(session.workspace_id, async (client) => {
      const { rows: [u] } = await client.query(
        `select ${USER_COLS} from app_user where id = $1`, [session.user_id]);
      return u;
    });
    if (!user) throw new Problem(401, "Unauthorized", "user no longer exists");
    res.json(publicUser(user));
  })().catch(next);
});

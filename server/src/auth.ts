import type { Request, Response, NextFunction } from "express";
import { Problem } from "./problem.js";
import { systemQuery } from "./db.js";
import { sha256 } from "./services/passwords.js";

export const SESSION_COOKIE = "pmtool_session";

// token -> workspace uuid, from API_TOKENS="token:uuid,token2:uuid2".
// Production replaces this with a hashed api_token table.
const tokens = new Map<string, string>(
  (process.env.API_TOKENS ?? "").split(",").filter(Boolean).map((pair) => {
    const [token, ws] = pair.split(":");
    if (!token?.trim() || !ws?.trim()) {
      console.error(`API_TOKENS entry "${pair}" is malformed - expected `
        + `format: token:workspace-uuid[,token2:uuid2]`);
      process.exit(1);
    }
    return [token.trim(), ws.trim()] as [string, string];
  }),
);
if (tokens.size === 0) {
  console.error("API_TOKENS is empty - no request could ever authenticate. "
    + "Set API_TOKENS=<token>:<workspace-uuid>");
  process.exit(1);
}

declare global {
  namespace Express {
    interface Request {
      workspaceId: string;
      // Set only for browser-session requests; bearer (machine) clients
      // have no acting user.
      userId?: string;
    }
  }
}

// Minimal cookie read; avoids the cookie-parser dependency.
export function readSessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// Two ways in: a browser session cookie (sets userId) or a bearer API
// token (machine-to-machine, no user).
export function auth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (bearer) {
    const ws = tokens.get(bearer);
    if (!ws) {
      return next(new Problem(401, "Unauthorized", "invalid bearer token"));
    }
    req.workspaceId = ws;
    return next();
  }

  const token = readSessionToken(req);
  if (!token) {
    return next(new Problem(401, "Unauthorized",
                            "missing bearer token or session"));
  }
  systemQuery(
    `select user_id, workspace_id from user_session
     where token_hash = $1 and expires_at > now()`, [sha256(token)])
    .then(({ rows: [session] }) => {
      if (!session) {
        return next(new Problem(401, "Unauthorized", "session expired"));
      }
      req.workspaceId = session.workspace_id;
      req.userId = session.user_id;
      next();
    })
    .catch(next);
}

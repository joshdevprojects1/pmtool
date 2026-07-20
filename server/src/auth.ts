import type { Request, Response, NextFunction } from "express";
import { Problem } from "./problem.js";

// token -> workspace uuid, from API_TOKENS="token:uuid,token2:uuid2".
// Production replaces this with a hashed api_token table.
const tokens = new Map<string, string>(
  (process.env.API_TOKENS ?? "").split(",").filter(Boolean).map((pair) => {
    const [token, ws] = pair.split(":");
    return [token.trim(), ws.trim()] as [string, string];
  }),
);

declare global {
  namespace Express {
    interface Request { workspaceId: string; }
  }
}

export function auth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const ws = tokens.get(token);
  if (!ws) return next(new Problem(401, "Unauthorized", "invalid bearer token"));
  req.workspaceId = ws;
  next();
}

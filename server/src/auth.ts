import type { Request, Response, NextFunction } from "express";
import { Problem } from "./problem.js";

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

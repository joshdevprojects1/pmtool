import type { Request, Response, NextFunction } from "express";

export class Problem extends Error {
  constructor(public status: number, public title: string,
              public detail = "") {
    super(title);
  }
}

export function problemHandler(err: unknown, _req: Request, res: Response,
                               _next: NextFunction): void {
  const p = err instanceof Problem
    ? err
    : new Problem(500, "Internal error",
                  err instanceof Error ? err.message : String(err));
  if (p.status === 500) console.error(err);
  res.status(p.status)
    .type("application/problem+json")
    .json({ type: "about:blank", title: p.title, status: p.status,
            detail: p.detail });
}

import pg from "pg";
import type { PoolClient } from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Managed Postgres over a public URL needs TLS; Railway's internal
  // network does not. Set DATABASE_SSL=true only for public connections.
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false } : undefined,
});

export type Client = PoolClient;

// Every request runs inside a transaction with app.workspace_id set, so the
// row-level security policies in 001_schema.sql enforce tenant isolation at
// the database layer no matter what the application code does.
export async function withWorkspace<T>(
  workspaceId: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.workspace_id', $1, true)",
                       [workspaceId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// System-level query OUTSIDE workspace RLS scoping - for machine-to-machine
// paths (ingest) that must resolve org -> workspace before a workspace
// context exists. NOTE: with the default single-role setup the db user owns
// the tables, and Postgres does not apply RLS to table owners; production
// should run the app as a non-owner role (and/or FORCE ROW LEVEL SECURITY)
// so withWorkspace is the only path that sees tenant data.
export async function systemQuery(sql: string, params: unknown[] = []) {
  return pool.query(sql, params);
}

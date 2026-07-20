// Migration runner: applies db/*.sql in filename order exactly once,
// tracked in schema_migrations. seed.sql is skipped unless SEED=true is set
// AND the database has no workspace yet (safe for first prod boot, inert
// afterwards). Runs before the API starts on every deploy, so schema changes
// merged to main apply to the live database automatically.

import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? "db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("migrate: DATABASE_URL is NOT set - the process will try "
      + "localhost and fail. Add it to this service's variables.");
  } else {
    try {
      const u = new URL(url);
      console.log(`migrate: connecting to ${u.hostname}:${u.port || 5432}`
        + `/${u.pathname.slice(1)}`);
    } catch {
      console.error("migrate: DATABASE_URL is set but not a valid URL "
        + "(check for quotes or whitespace)");
    }
  }
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename    text primary key,
        applied_at  timestamptz not null default now()
      )`);
    // Serialize concurrent deploys (api + worker starting together).
    await client.query("select pg_advisory_lock(727272)");

    const { rows } = await client.query("select filename from schema_migrations");
    const applied = new Set(rows.map((r) => r.filename));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && f !== "seed.sql")
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`migrate: applying ${file}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }

    if (process.env.SEED === "true") {
      const { rows: [ws] } = await client.query("select 1 from workspace limit 1");
      if (!ws) {
        console.log("migrate: empty database, applying seed.sql");
        await client.query(readFileSync(
          path.join(MIGRATIONS_DIR, "seed.sql"), "utf8"));
      }
    }
    console.log("migrate: up to date");
  } finally {
    await client.query("select pg_advisory_unlock(727272)").catch(() => undefined);
    await client.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

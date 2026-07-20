// Ingestion: poll one org, normalize into the ledger, enrich descriptions,
// respect the daily API budget, advance the watermark. The polling loop that
// drives this lives in worker.ts.

import type { Client } from "../db.js";
import {
  SfClient, SfError, pollSourceMember, pollAuditTrail, fetchDescriptions,
  NormalizedEvent,
} from "./salesforce.js";

export interface OrgRow {
  id: string;
  workspace_id: string;
  auth_mode: string;
  label: string;
  instance_url: string;
  last_synced_at: string | null;
  api_budget_daily: number;
  api_calls_today: number;
  api_calls_date: string | null;
}

export interface PollResult {
  source: string;
  fetched: number;
  inserted: number;
  apiCalls: number;
  skipped?: string;
}

function soqlDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function pollOrg(
  client: Client, org: OrgRow, sf: SfClient,
): Promise<PollResult> {
  // budget check - resets daily
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = org.api_calls_date === today ? org.api_calls_today : 0;
  if (usedToday >= org.api_budget_daily) {
    return { source: "none", fetched: 0, inserted: 0, apiCalls: 0,
             skipped: "daily API budget exhausted" };
  }

  // Overlap window: back the watermark up 5 minutes so audit-trail write
  // lag can never permanently skip an event (dedupe absorbs the repeats).
  const OVERLAP_MS = 5 * 60 * 1000;
  // First poll of an org looks back INITIAL_BACKFILL_DAYS (default 7).
  // SetupAuditTrail retains ~180 days, so up to that is meaningful.
  const backfillDays = Number(process.env.INITIAL_BACKFILL_DAYS ?? 7);
  const since = org.last_synced_at
    ? soqlDate(new Date(new Date(org.last_synced_at).getTime() - OVERLAP_MS))
    : soqlDate(new Date(Date.now() - backfillDays * 24 * 3600 * 1000));

  // Poll BOTH sources every tick. SourceMember can be queryable-but-empty
  // on orgs without source tracking (it succeeds with zero rows), so
  // "fall back only on error" silently captures nothing - learned the hard
  // way. The ledger dedupe key makes dual-source capture safe.
  let smEvents: NormalizedEvent[] = [];
  let smNote = "";
  try {
    smEvents = await pollSourceMember(sf, since);
  } catch (err) {
    if (!(err instanceof SfError)) throw err;
    smNote = ` (SourceMember unavailable: ${err.status})`;
  }
  const atEvents = await pollAuditTrail(sf, since);
  const events = [...smEvents, ...atEvents];
  const source = `since ${since}: source_tracking=${smEvents.length}`
    + `${smNote}, audit_trail=${atEvents.length}`;

  let inserted = 0;
  let latest: string | null = null;
  for (const ev of events) {
    const { rows: [comp] } = await client.query(
      `insert into component (workspace_id, component_type, api_name)
       values ($1, $2, $3)
       on conflict (workspace_id, component_type, api_name)
         do update set api_name = excluded.api_name
       returning id`,
      [org.workspace_id, ev.componentType, ev.apiName]);
    const { rowCount } = await client.query(
      `insert into change_event (workspace_id, org_connection_id, component_id,
         operation, author_username, occurred_at, source, source_ref)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (org_connection_id, component_id, occurred_at, source)
         do nothing`,
      [org.workspace_id, org.id, comp.id, ev.operation, ev.author,
       ev.occurredAt, ev.source, ev.sourceRef]);
    inserted += rowCount ?? 0;
    if (!latest || ev.occurredAt > latest) latest = ev.occurredAt;
  }

  // Enrichment: component descriptions feed the description_key signal.
  const enrichments = await fetchDescriptions(sf);
  for (const e of enrichments) {
    await client.query(
      `insert into component_meta (component_id, description, updated_at)
       select id, $1, now() from component
       where api_name ilike '%' || $2 || '%'
       on conflict (component_id)
         do update set description = excluded.description, updated_at = now()`,
      [e.description, e.match]);
  }

  await client.query(
    `update org_connection set
       last_synced_at = coalesce($1, last_synced_at),
       api_calls_today = case when api_calls_date = $2::date
         then api_calls_today + $3 else $3 end,
       api_calls_date = $2::date
     where id = $4`,
    [latest, today, sf.apiCalls, org.id]);

  return { source, fetched: events.length, inserted, apiCalls: sf.apiCalls };
}

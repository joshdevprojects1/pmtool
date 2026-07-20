import type { Client } from "../db.js";

// Signal weights - mirror the architecture doc section 6 and the validated
// prototype (linking_prototype.py).
const W_COMMIT_KEY = 0.85;
const W_DESC_KEY = 0.8;
const W_AUTHOR_TIME = 0.4;
const W_AFFINITY = 0.15;
const TIME_SLACK_MS = 12 * 3600 * 1000;

// Learned from live-org data: these component types generate admin noise
// (password changes, org settings) and may not be suggested on the
// author+time signal alone - they need a key-based signal.
const WEAK_ALONE_TYPES = new Set([
  "Setup", "Profile", "PermissionSet", "PermissionSetGroup",
  "Report", "Dashboard", "ListView", "User",
]);

const KEY_RE = /[A-Z][A-Z0-9]+-\d+/g;

interface Signal { kind: string; weight: number; detail: string; }

function noisyOr(weights: number[]): number {
  return 1 - weights.reduce((p, w) => p * (1 - w), 1);
}

export async function scoreChanges(client: Client): Promise<number> {
  const { rows: [ws] } = await client.query(
    "select link_score_threshold as threshold from workspace");
  if (!ws) return 0;
  const threshold = Number(ws.threshold);

  const { rows: tickets } = await client.query(`
    select t.id, p.key || '-' || t.number as key, t.started_at,
           t.finished_at, u.sf_usernames,
           array(select tf.feature_id from ticket_feature tf
                 where tf.ticket_id = t.id) as feature_ids
    from ticket t
    join project p on p.id = t.project_id
    left join app_user u on u.id = t.assignee_id`);

  const { rows: events } = await client.query(`
    select ce.id, ce.component_id, ce.author_username, ce.occurred_at,
           ce.source, ce.source_ref, c.component_type, c.api_name,
           coalesce(cm.description, '') as description,
           d.commit_message
    from change_event ce
    join component c on c.id = ce.component_id
    left join component_meta cm on cm.component_id = c.id
    left join deployment d on ce.source = 'cicd'
      and d.id::text = ce.source_ref`);

  let created = 0;
  for (const ev of events) {
    const commitKeys = new Set((ev.commit_message ?? "").match(KEY_RE) ?? []);
    const descKeys = new Set((ev.description ?? "").match(KEY_RE) ?? []);
    const when = new Date(ev.occurred_at).getTime();

    for (const t of tickets) {
      const signals: Signal[] = [];
      if (commitKeys.has(t.key)) {
        signals.push({ kind: "commit_message_key", weight: W_COMMIT_KEY,
                       detail: `${t.key} in commit message` });
      }
      if (descKeys.has(t.key)) {
        signals.push({ kind: "description_key", weight: W_DESC_KEY,
                       detail: `${t.key} in component description` });
      }
      const names: string[] = t.sf_usernames ?? [];
      if (ev.author_username && names.includes(ev.author_username) &&
          t.started_at && t.finished_at &&
          when >= new Date(t.started_at).getTime() - TIME_SLACK_MS &&
          when <= new Date(t.finished_at).getTime() + TIME_SLACK_MS) {
        signals.push({ kind: "author_time_window", weight: W_AUTHOR_TIME,
                       detail: `author has ${t.key} active in window` });
      }
      if (signals.length === 0) continue;

      const hasKeySignal = signals.some(
        (s) => s.kind === "commit_message_key" || s.kind === "description_key");
      if (WEAK_ALONE_TYPES.has(ev.component_type) && !hasKeySignal) continue;

      if ((t.feature_ids ?? []).length > 0) {
        const { rows: aff } = await client.query(
          `select 1 from component_link where component_id = $1
           and entity_type = 'feature' and entity_id = any($2::uuid[])
           limit 1`,
          [ev.component_id, t.feature_ids]);
        if (aff.length > 0) {
          signals.push({ kind: "component_affinity", weight: W_AFFINITY,
                         detail: "component already linked to a ticket feature" });
        }
      }

      const score = Math.round(noisyOr(signals.map((s) => s.weight)) * 1000) / 1000;
      if (score < threshold) continue;

      const { rowCount } = await client.query(
        `insert into link_suggestion (workspace_id, change_event_id,
           change_occurred_at, ticket_id, score, signals)
         select current_setting('app.workspace_id')::uuid, $1, $2, $3, $4, $5
         on conflict (change_event_id, change_occurred_at, ticket_id)
           do nothing`,
        [ev.id, ev.occurred_at, t.id, score, JSON.stringify(signals)]);
      created += rowCount ?? 0;
    }
  }
  return created;
}

// Accept = the two-level write: ticket_change attribution + durable
// component_link upsert. Returns null if already resolved (caller 409s).
export async function acceptSuggestion(client: Client, id: string) {
  const { rows: [s] } = await client.query(
    `update link_suggestion set status = 'accepted', resolved_at = now()
     where id = $1 and status = 'pending' returning *`, [id]);
  if (!s) return null;
  await client.query(
    `insert into ticket_change (workspace_id, ticket_id, change_event_id,
       change_occurred_at, origin, suggestion_id)
     values (current_setting('app.workspace_id')::uuid, $1, $2, $3,
             'suggestion', $4)
     on conflict do nothing`,
    [s.ticket_id, s.change_event_id, s.change_occurred_at, s.id]);
  await client.query(
    `insert into component_link (workspace_id, component_id, entity_type,
       entity_id, origin)
     select current_setting('app.workspace_id')::uuid, ce.component_id,
            'feature', tf.feature_id, 'suggestion'
     from change_event ce, ticket_feature tf
     where ce.id = $1 and tf.ticket_id = $2
     on conflict (component_id, entity_type, entity_id) do nothing`,
    [s.change_event_id, s.ticket_id]);
  return s;
}

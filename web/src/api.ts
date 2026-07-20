// Baked in at build time; set VITE_API_TOKEN when building for production.
const TOKEN = import.meta.env.VITE_API_TOKEN ?? "dev-token";

export interface Page<T> { data: T[]; next_cursor: string | null; }

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch("/v1" + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw body;
  return body as T;
}

export interface FeatureRef { id: string; name: string; }
export interface Ticket {
  id: string; key: string; title: string; description: string | null;
  status: string; priority: number; assignee_id: string | null;
  features: FeatureRef[];
}
export interface Signal { kind: string; weight: number; detail: string; }
export interface Suggestion {
  id: string; ticket_id: string; score: string | number; signals: Signal[];
  status: string; change_event_id: string; operation: string;
  author_username: string | null; occurred_at: string; source: string;
  component_type: string; api_name: string;
}
export interface TicketChange {
  ticket_id: string; origin: string; change_event_id: string;
  operation: string; author_username: string | null; occurred_at: string;
  source: string; component_type: string; api_name: string;
}
export interface Feature {
  id: string; project_id: string; name: string;
  description: string | null; status: string;
  sort_order: number; ticket_count: number;
}
export interface FeatureTicket {
  id: string; key: string; title: string; status: string;
  priority: number; assignee_id: string | null;
}
export interface FeatureComponent {
  id: string; component_type: string; api_name: string; origin: string;
  last_change: { occurred_at: string; author_username: string | null;
                 operation: string } | null;
  orgs_seen: string[] | null;
}
export interface ChangeEvent {
  id: string; operation: string; author_username: string | null;
  occurred_at: string; source: string; org: string;
  component_type: string; api_name: string;
}

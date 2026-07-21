// Browser requests authenticate with the pmtool_session cookie (set by
// /v1/auth/login). A 401 anywhere flips the app back to the login screen
// via the pmtool:unauthorized event.
export interface Page<T> { data: T[]; next_cursor: string | null; }

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch("/v1" + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (res.status === 401 && !path.startsWith("/auth/")) {
    window.dispatchEvent(new Event("pmtool:unauthorized"));
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw body;
  return body as T;
}

export interface User {
  id: string; email: string; display_name: string; role: string;
  sf_usernames: string[];
}
export interface Sprint {
  id: string; project_id: string; name: string; goal: string | null;
  starts_on: string | null; ends_on: string | null;
  status: "planned" | "active" | "completed";
  ticket_count: number; done_count: number;
}
export interface SearchResults {
  tickets: Array<{ id: string; key: string; title: string; status: string }>;
  features: Array<{ id: string; name: string; status: string }>;
  components: Array<{ id: string; component_type: string; api_name: string }>;
}
export interface Invite {
  id: string; email: string; role: string; created_at: string;
  expires_at: string; invited_by_name?: string | null; token?: string;
}
export interface FeatureRef { id: string; name: string; }
export interface Ticket {
  id: string; key: string; title: string; description: string | null;
  status: string; priority: number; assignee_id: string | null;
  assignee_name: string | null; sprint_id: string | null;
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

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]!.toUpperCase()).join("") || "?";
}

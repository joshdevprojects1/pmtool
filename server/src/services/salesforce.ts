// Salesforce REST client + pollers. Direct port of the validated prototype
// (sf_ingest_spike.py): SourceMember via the Tooling API where source
// tracking exists, SetupAuditTrail fallback everywhere else, plus
// description enrichment for the description_key linking signal.

const API_VERSION = "62.0";
const KEY_RE = /[A-Z][A-Z0-9]+-\d+/g;

export interface NormalizedEvent {
  componentType: string;
  apiName: string;
  operation: "create" | "update" | "delete";
  author: string | null;
  occurredAt: string;
  source: "source_tracking" | "audit_trail";
  sourceRef: string | null;
  raw: unknown;
}

export class SfClient {
  public apiCalls = 0;
  constructor(private token: string, private instanceUrl: string) {}

  private async get(path: string, params?: Record<string, string>) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    const headers = { Authorization: `Bearer ${this.token.trim()}`,
                      Accept: "application/json" };
    this.apiCalls += 1;
    let url = this.instanceUrl.trim().replace(/\/$/, "") + path + qs;
    // fetch strips the Authorization header on cross-origin redirects, which
    // Salesforce surfaces as INVALID_AUTH_HEADER. Follow redirects manually
    // so the header survives.
    for (let hop = 0; hop < 3; hop++) {
      const res = await fetch(url, { headers, redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new SfError(res.status, "redirect without location");
        url = loc.startsWith("http")
          ? loc : this.instanceUrl.trim().replace(/\/$/, "") + loc;
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        if (body.includes("INVALID_AUTH_HEADER")
            || body.includes("INVALID_SESSION_ID")) {
          console.error("[sf] auth diagnostic: token length="
            + this.token.trim().length + ", starts with '"
            + this.token.trim().slice(0, 8) + "...', instance="
            + this.instanceUrl.trim());
        }
        throw new SfError(res.status, body.slice(0, 400));
      }
      return res.json();
    }
    throw new SfError(310, "too many redirects");
  }

  async queryAll(soql: string, tooling = false): Promise<any[]> {
    const prefix = `/services/data/v${API_VERSION}${tooling ? "/tooling" : ""}/query`;
    let resp = await this.get(prefix, { q: soql });
    const out: any[] = [...(resp.records ?? [])];
    while (!resp.done && resp.nextRecordsUrl) {
      resp = await this.get(resp.nextRecordsUrl);
      out.push(...(resp.records ?? []));
    }
    return out;
  }
}

export class SfError extends Error {
  constructor(public status: number, public body: string) {
    super(`Salesforce API error ${status}`);
  }
}

// OAuth refresh-token exchange - the production auth path.
export async function refreshAccessToken(
  instanceUrl: string, clientId: string, clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await fetch(
    instanceUrl.replace(/\/$/, "") + "/services/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
    });
  if (!res.ok) throw new SfError(res.status, (await res.text()).slice(0, 400));
  const body = await res.json();
  return body.access_token as string;
}

// Client credentials grant - the recommended commercial flow. The customer
// admin installs the connected app in their org and designates a dedicated
// integration user (API-only "Salesforce Integration" license) as the
// run-as user; no interactive login, no refresh token to store.
export async function clientCredentialsToken(
  instanceUrl: string, clientId: string, clientSecret: string,
): Promise<string> {
  const res = await fetch(
    instanceUrl.replace(/\/$/, "") + "/services/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId, client_secret: clientSecret,
      }).toString(),
    });
  if (!res.ok) throw new SfError(res.status, (await res.text()).slice(0, 400));
  const body = await res.json();
  return body.access_token as string;
}

export async function pollSourceMember(
  client: SfClient, sinceIso: string,
): Promise<NormalizedEvent[]> {
  const records = await client.queryAll(
    `select MemberType, MemberName, RevisionCounter, IsNameObsolete,
            LastModifiedDate, LastModifiedBy.Name
     from SourceMember where LastModifiedDate > ${sinceIso}
     order by LastModifiedDate asc`, true);
  return records.map((r) => ({
    componentType: r.MemberType,
    apiName: r.MemberName,
    operation: r.IsNameObsolete ? "delete" : "update",
    author: r.LastModifiedBy?.Name ?? null,
    occurredAt: r.LastModifiedDate,
    source: "source_tracking",
    sourceRef: `rev:${r.RevisionCounter}`,
    raw: r,
  }));
}

// Audit-trail Display strings are human text and phrasing varies by org and
// edition (validated against a live Developer Edition org). Unmatched rows
// are kept as componentType='Setup' so nothing is silently dropped.
const AUDIT_PATTERNS: Array<[RegExp, string]> = [
  [/(?:Changed|Created|Deleted) Apex Class ([\w.]+)/, "ApexClass"],
  [/(?:Changed|Created|Deleted) Apex Trigger ([\w.]+)/, "ApexTrigger"],
  [/flow with Name ".*?" and Unique Name "([\w]+)"/, "Flow"],
  [/[Ff]low (?:version )?(?:.* )?named ([\w-]+)/, "Flow"],
  [/custom field:? "?([^("]+?)"?\s*\(/, "CustomField"],
  [/(?:Created|Changed|Deleted) custom field ([\w.]+)/, "CustomField"],
  [/(?:Created|Changed|Deleted) custom object:? ([\w.]+)/, "CustomObject"],
  [/(?:Changed|Created|Deleted) validation rule ([\w.]+)/, "ValidationRule"],
  [/(?:Changed|Created) page layout ([\w.]+)/, "Layout"],
  [/(?:Changed|Created|Deleted) profile ([\w.]+)/, "Profile"],
  [/[Pp]ermission set group (\w+)/, "PermissionSetGroup"],
  [/permission set ([\w.]+)/, "PermissionSet"],
  [/Lightning Page:? ([\w ]+?)\s*$/, "FlexiPage"],
];

export function normalizeAuditRow(r: any): NormalizedEvent {
  const display: string = r.Display ?? "";
  const action: string = r.Action ?? "";
  let componentType = "Setup";
  let apiName = action || "unknown";
  for (const [pattern, mapped] of AUDIT_PATTERNS) {
    const m = display.match(pattern);
    if (m) {
      componentType = mapped;
      apiName = m[m.length - 1].trim().replace(/^"|"$/g, "").replace(/ /g, "_");
      break;
    }
  }
  const lower = action.toLowerCase();
  const operation = lower.startsWith("create") ? "create"
    : lower.startsWith("delete") ? "delete" : "update";
  return {
    componentType, apiName, operation,
    author: r.CreatedBy?.Name ?? null,
    occurredAt: r.CreatedDate,
    source: "audit_trail",
    sourceRef: r.Id ?? null,
    raw: r,
  };
}

export async function pollAuditTrail(
  client: SfClient, sinceIso: string,
): Promise<NormalizedEvent[]> {
  const records = await client.queryAll(
    `select Id, Action, Section, Display, CreatedDate, CreatedBy.Name
     from SetupAuditTrail where CreatedDate > ${sinceIso}
     order by CreatedDate asc limit 2000`);
  return records.map(normalizeAuditRow);
}

export interface Enrichment { match: string; description: string; }

// Best-effort description fetch for the description_key signal.
export async function fetchDescriptions(
  client: SfClient,
): Promise<Enrichment[]> {
  const out: Enrichment[] = [];
  try {
    const fields = await client.queryAll(
      "select DeveloperName, Description from CustomField"
      + " where Description != null", true);
    for (const f of fields) {
      out.push({ match: f.DeveloperName, description: f.Description });
    }
  } catch { /* org may restrict tooling CustomField - non-fatal */ }
  try {
    const flows = await client.queryAll(
      "select ApiName, Description from FlowDefinitionView"
      + " where Description != null");
    for (const f of flows) {
      out.push({ match: f.ApiName, description: f.Description });
    }
  } catch { /* non-fatal */ }
  return out;
}

export function findTicketKeys(text: string): string[] {
  return [...new Set(text.match(KEY_RE) ?? [])];
}

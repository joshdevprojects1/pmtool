import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";

interface Org {
  id: string; sf_org_id: string; org_type: string; label: string;
  instance_url: string; status: string; auth_note: string | null;
  api_budget_daily: number; api_calls_today: number;
  last_synced_at: string | null;
}

export function Orgs() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [label, setLabel] = useState("");
  const [orgType, setOrgType] = useState("sandbox");
  const [authMode, setAuthMode] = useState("oauth");
  const [instanceUrl, setInstanceUrl] = useState("");
  const [notice, setNotice] = useState("");

  const load = () =>
    api<{ data: Org[] }>("/orgs").then((d) => setOrgs(d.data));
  useEffect(() => { load(); }, []);

  async function connect(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    try {
      const body: Record<string, unknown> = { label, org_type: orgType };
      if (authMode === "client_credentials") {
        body.auth_mode = "client_credentials";
        body.instance_url = instanceUrl;
      }
      const r = await api<{ authorize_url?: string }>("/orgs", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (r.authorize_url) {
        window.open(r.authorize_url, "_blank");
        setNotice("Approve the connection in the Salesforce tab, then"
          + " refresh this page.");
      } else {
        setNotice("Org added.");
      }
      setLabel("");
      load();
    } catch (err: any) {
      setNotice(err.detail ?? err.title ?? "Connect failed");
    }
  }

  async function pause(id: string) {
    await api(`/orgs/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      <div className="card">
        <h2>Connect a Salesforce org</h2>
        <form onSubmit={connect}
              style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)}
                 placeholder="Label, e.g. Production" style={{ flex: 1 }} />
          <select value={orgType} onChange={(e) => setOrgType(e.target.value)}>
            <option value="production">production</option>
            <option value="sandbox">sandbox</option>
            <option value="scratch">scratch</option>
          </select>
          <select value={authMode} onChange={(e) => setAuthMode(e.target.value)}>
            <option value="oauth">OAuth login (interactive)</option>
            <option value="client_credentials">
              Client credentials (integration user)
            </option>
          </select>
          {authMode === "client_credentials" && (
            <input value={instanceUrl}
                   onChange={(e) => setInstanceUrl(e.target.value)}
                   placeholder="https://yourorg.my.salesforce.com"
                   style={{ flex: "1 1 100%" }} />
          )}
          <button className="primary">Connect</button>
        </form>
        {notice && <p className="muted" style={{ marginBottom: 0 }}>{notice}</p>}
      </div>
      <div className="card">
        <h2>Connected orgs</h2>
        {orgs.length === 0 && <div className="empty">No orgs yet</div>}
        {orgs.map((o) => (
          <div className="row" key={o.id}>
            <span style={{ fontWeight: 600 }}>{o.label}</span>
            <span className="pill blue">{o.org_type}</span>
            <span className={`pill ${o.status === "active" ? "green" : "blue"}`}>
              {o.status}
            </span>
            <span className="muted">
              {o.instance_url} · API today: {o.api_calls_today}/
              {o.api_budget_daily}
              {o.last_synced_at
                ? ` · synced ${String(o.last_synced_at).slice(0, 16)}` : ""}
              {o.auth_note ? ` · ${o.auth_note}` : ""}
            </span>
            {o.status === "active" && (
              <button className="right" onClick={() => pause(o.id)}>Pause</button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

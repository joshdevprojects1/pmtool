import { useEffect, useState } from "react";
import { api, Feature, FeatureComponent, FeatureTicket, Page, Ticket }
  from "../api";

export function FeatureView({ id, onChanged }:
    { id: string; onChanged: () => void }) {
  const [feature, setFeature] = useState<Feature | null>(null);
  const [tickets, setTickets] = useState<FeatureTicket[]>([]);
  const [comps, setComps] = useState<FeatureComponent[]>([]);
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const load = () => Promise.all([
    api<Feature>(`/features/${id}`),
    api<{ data: FeatureTicket[] }>(`/features/${id}/tickets`),
    api<{ data: FeatureComponent[] }>(`/features/${id}/components`),
    api<Page<Ticket>>("/tickets?limit=200"),
  ]).then(([f, t, c, all]) => {
    setFeature(f); setTickets(t.data); setComps(c.data);
    setAllTickets(all.data);
    setName(f.name); setDesc(f.description ?? "");
  });
  useEffect(() => { load(); }, [id]);

  if (!feature) return <div className="card"><div className="empty">Loading…</div></div>;

  async function patch(body: object) {
    await api(`/features/${id}`, { method: "PATCH",
                                   body: JSON.stringify(body) });
    load(); onChanged();
  }
  async function saveEdit() {
    await patch({ name: name.trim() || feature!.name, description: desc });
    setEditing(false);
  }
  async function linkTicket(tid: string) {
    if (!tid) return;
    try {
      await api(`/tickets/${tid}/features`, {
        method: "POST", body: JSON.stringify({ feature_id: id }) });
      load(); onChanged();
    } catch (e: any) { alert(e.title ?? "Link failed"); }
  }
  async function unlinkTicket(tid: string) {
    await api(`/tickets/${tid}/features/${id}`, { method: "DELETE" });
    load(); onChanged();
  }

  const linked = new Set(tickets.map((t) => t.id));
  const linkable = allTickets.filter((t) => !linked.has(t.id));

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12,
                      flexWrap: "wrap" }}>
          <a href="#features" className="muted">← features</a>
          <select value={feature.status}
                  onChange={(e) => patch({ status: e.target.value })}>
            {["open", "in_progress", "done", "archived"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button className="right" onClick={() => setEditing(!editing)}>
            {editing ? "Cancel" : "Edit"}
          </button>
        </div>
        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8,
                        marginTop: 8 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <textarea value={desc} rows={4} placeholder="Description"
                      onChange={(e) => setDesc(e.target.value)} />
            <div><button className="primary" onClick={saveEdit}>Save</button></div>
          </div>
        ) : (
          <>
            <h2 style={{ marginTop: 8 }}>{feature.name}</h2>
            {feature.description && (
              <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
                {feature.description}
              </p>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>Tickets ({tickets.length})</h2>
        {tickets.length === 0 && (
          <div className="empty">No tickets linked yet</div>
        )}
        {tickets.map((t) => (
          <div className="row" key={t.id}>
            <a href={`#ticket/${t.id}`} className="key">{t.key}</a>
            <span>{t.title}</span>
            <span className="pill blue">{t.status}</span>
            <button className="right"
                    onClick={() => unlinkTicket(t.id)}>Unlink</button>
          </div>
        ))}
        {linkable.length > 0 && (
          <div className="row">
            <select defaultValue=""
                    onChange={(e) => { linkTicket(e.target.value);
                                       e.target.value = ""; }}>
              <option value="" disabled>Link a ticket…</option>
              {linkable.map((t) => (
                <option key={t.id} value={t.id}>{t.key} {t.title}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Components ({comps.length})</h2>
        {comps.length === 0 && (
          <div className="empty">No components linked yet</div>
        )}
        {comps.map((c) => (
          <div className="row" key={c.id}>
            <span className="mono">{c.component_type}:{c.api_name}</span>
            <span className={`pill ${c.origin === "manual" ? "blue" : "green"}`}>
              {c.origin}
            </span>
            <span className="muted right">
              {c.orgs_seen?.length ? `orgs: ${c.orgs_seen.join(", ")}` : ""}
              {c.last_change
                ? ` · last ${c.last_change.occurred_at.slice(0, 16)} by ${
                    c.last_change.author_username ?? "?"}`
                : ""}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

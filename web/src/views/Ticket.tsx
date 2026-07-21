import { useEffect, useState } from "react";
import { api, Feature, Page, Sprint, Suggestion, Ticket, TicketChange, User }
  from "../api";
import { SuggestionRow } from "./SuggestionRow";

export function TicketView({ id, onChanged }:
    { id: string; onChanged: () => void }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [changes, setChanges] = useState<TicketChange[]>([]);
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [allFeatures, setAllFeatures] = useState<Feature[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [linkId, setLinkId] = useState("");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  const load = () => Promise.all([
    api<Ticket>(`/tickets/${id}`),
    api<{ data: TicketChange[] }>(`/tickets/${id}/changes`),
    api<Page<Suggestion>>(`/suggestions?status=pending&ticket_id=${id}&limit=100`),
    api<Page<Feature>>("/features"),
    api<{ data: User[] }>("/users"),
    api<{ data: Sprint[] }>("/sprints"),
  ]).then(([t, c, s, f, u, sp]) => {
    setTicket(t); setChanges(c.data); setSugg(s.data); setAllFeatures(f.data);
    setUsers(u.data); setSprints(sp.data);
    setTitle(t.title); setDesc(t.description ?? "");
  });
  useEffect(() => { load(); }, [id]);

  if (!ticket) return <div className="card"><div className="empty">Loading…</div></div>;

  async function patch(body: object) {
    await api(`/tickets/${id}`, { method: "PATCH",
                                  body: JSON.stringify(body) });
    load(); onChanged();
  }
  async function saveEdit() {
    await patch({ title: title.trim() || ticket!.title, description: desc });
    setEditing(false);
  }
  async function addFeature(fid: string) {
    if (!fid) return;
    try {
      await api(`/tickets/${id}/features`, {
        method: "POST", body: JSON.stringify({ feature_id: fid }) });
      load(); onChanged();
    } catch (e: any) { alert(e.title ?? "Link failed"); }
  }
  async function removeFeature(fid: string) {
    await api(`/tickets/${id}/features/${fid}`, { method: "DELETE" });
    load(); onChanged();
  }
  async function unlink(eventId: string) {
    await api(`/tickets/${id}/changes/${eventId}`, { method: "DELETE" });
    load(); onChanged();
  }
  async function manualLink() {
    if (!linkId.trim()) return;
    try {
      await api(`/tickets/${id}/changes`, {
        method: "POST",
        body: JSON.stringify({ change_event_id: linkId.trim() }) });
      setLinkId(""); load(); onChanged();
    } catch (e: any) { alert(e.title ?? "Link failed"); }
  }

  const linked = new Set(ticket.features.map((f) => f.id));
  const linkable = allFeatures.filter((f) => !linked.has(f.id));

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12,
                      flexWrap: "wrap" }}>
          <span className="key">{ticket.key}</span>
          <select value={ticket.status}
                  onChange={(e) => patch({ status: e.target.value })}>
            {["open", "in_progress", "done"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <label className="muted">priority
            <select value={ticket.priority} style={{ marginLeft: 6 }}
                    onChange={(e) => patch({ priority: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="muted">assignee
            <select value={ticket.assignee_id ?? ""} style={{ marginLeft: 6 }}
                    onChange={(e) =>
                      patch({ assignee_id: e.target.value || null })}>
              <option value="">unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.display_name}</option>
              ))}
            </select>
          </label>
          <label className="muted">sprint
            <select value={ticket.sprint_id ?? ""} style={{ marginLeft: 6 }}
                    onChange={(e) =>
                      patch({ sprint_id: e.target.value || null })}>
              <option value="">backlog</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.status === "active" ? " ● active" : ""}
                </option>
              ))}
            </select>
          </label>
          <button className="right" onClick={() => setEditing(!editing)}>
            {editing ? "Cancel" : "Edit"}
          </button>
        </div>
        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8,
                        marginTop: 8 }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea value={desc} rows={4} placeholder="Description"
                      onChange={(e) => setDesc(e.target.value)} />
            <div><button className="primary" onClick={saveEdit}>Save</button></div>
          </div>
        ) : (
          <>
            <h2 style={{ marginTop: 8 }}>{ticket.title}</h2>
            {ticket.description && (
              <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
                {ticket.description}
              </p>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>Features ({ticket.features.length})</h2>
        {ticket.features.length === 0 && (
          <div className="empty">Not linked to any feature</div>
        )}
        {ticket.features.map((f) => (
          <div className="row" key={f.id}>
            <a href={`#feature/${f.id}`}>{f.name}</a>
            <button className="right"
                    onClick={() => removeFeature(f.id)}>Unlink</button>
          </div>
        ))}
        {linkable.length > 0 && (
          <div className="row">
            <select defaultValue=""
                    onChange={(e) => { addFeature(e.target.value);
                                       e.target.value = ""; }}>
              <option value="" disabled>Link a feature…</option>
              {linkable.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Linked changes ({changes.length})</h2>
        {changes.length === 0 && (
          <div className="empty">No confirmed changes yet</div>
        )}
        {changes.map((tc) => (
          <div className="row" key={tc.change_event_id}>
            <span className="mono">{tc.component_type}:{tc.api_name}</span>
            <span className="muted">
              {tc.operation} · {tc.author_username ?? "?"} ·{" "}
              {tc.occurred_at.slice(0, 16)} · {tc.source}
            </span>
            <span className={`pill ${tc.origin === "manual" ? "blue" : "green"}`}>
              {tc.origin}
            </span>
            <button className="right"
                    onClick={() => unlink(tc.change_event_id)}>Unlink</button>
          </div>
        ))}
        <div className="row">
          <input value={linkId} onChange={(e) => setLinkId(e.target.value)}
                 placeholder="change event id" style={{ width: 300 }} />
          <button onClick={manualLink}>Link manually</button>
          <span className="muted">ids are in the change ledger tab</span>
        </div>
      </div>

      <div className="card">
        <h2>Suggested links ({sugg.length})</h2>
        {sugg.length === 0 && (
          <div className="empty">No pending suggestions for this ticket</div>
        )}
        {sugg.map((s) => (
          <SuggestionRow key={s.id} s={s}
                         onActed={() => { load(); onChanged(); }} />
        ))}
      </div>
    </>
  );
}

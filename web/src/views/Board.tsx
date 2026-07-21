import { FormEvent, useEffect, useState } from "react";
import { api, initials, Page, Sprint, Ticket, User } from "../api";

const COLUMNS: Array<[string, string]> = [
  ["open", "Open"], ["in_progress", "In progress"], ["done", "Done"]];

export function Board({ sprintId, onChanged }:
    { sprintId?: string; onChanged: () => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [title, setTitle] = useState("");
  // "" = all, "backlog" = no sprint, else sprint uuid.
  const [sprint, setSprint] = useState(sprintId ?? "");
  const [assignee, setAssignee] = useState("");

  useEffect(() => { setSprint(sprintId ?? ""); }, [sprintId]);

  const load = () => {
    const params = new URLSearchParams({ limit: "200" });
    if (sprint) params.set("sprint_id", sprint);
    if (assignee) params.set("assignee_id", assignee);
    return api<Page<Ticket>>(`/tickets?${params}`)
      .then((d) => setTickets(d.data));
  };
  useEffect(() => { load(); }, [sprint, assignee]);
  useEffect(() => {
    api<{ data: Sprint[] }>("/sprints").then((d) => setSprints(d.data));
    api<{ data: User[] }>("/users").then((d) => setUsers(d.data));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api("/tickets", {
      method: "POST",
      body: JSON.stringify({
        title,
        sprint_id: sprint && sprint !== "backlog" ? sprint : undefined,
        assignee_id: assignee || undefined,
      }),
    });
    setTitle("");
    load();
    onChanged();
  }

  const active = sprints.find((s) => s.id === sprint);

  return (
    <>
      <div className="card">
        <div className="board-bar">
          <select value={sprint}
                  onChange={(e) => { setSprint(e.target.value);
                    location.hash = e.target.value
                      ? `#board/${e.target.value}` : "#board"; }}>
            <option value="">All tickets</option>
            <option value="backlog">Backlog (no sprint)</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.status === "active" ? " ● active" : ""}
              </option>
            ))}
          </select>
          <select value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Everyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.display_name}</option>
            ))}
          </select>
          {active?.goal && (
            <span className="muted">Goal: {active.goal}</span>
          )}
          <a className="right muted" href="#sprints">Manage sprints →</a>
        </div>
        <form onSubmit={create}
              style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
                 placeholder={active
                   ? `New ticket in ${active.name}` : "New ticket title"}
                 style={{ flex: 1 }} />
          <button className="primary">Create ticket</button>
        </form>
      </div>
      <div className="cols">
        {COLUMNS.map(([status, label]) => {
          const cards = tickets.filter((t) => t.status === status);
          return (
            <div className="col" key={status}>
              <h3>{label} ({cards.length})</h3>
              {cards.map((t) => (
                <div className="tcard" key={t.id}
                     onClick={() => { location.hash = `#ticket/${t.id}`; }}>
                  <div className="key">{t.key}</div>
                  <div>{t.title}</div>
                  <div className="tcard-foot">
                    {t.features.length > 0 && (
                      <span className="muted">{t.features[0].name}
                        {t.features.length > 1
                          ? ` +${t.features.length - 1}` : ""}</span>
                    )}
                    {t.assignee_name && (
                      <span className="avatar right"
                            title={t.assignee_name}>
                        {initials(t.assignee_name)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

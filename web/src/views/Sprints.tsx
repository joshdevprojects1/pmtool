import { FormEvent, useEffect, useState } from "react";
import { api, Sprint } from "../api";

const STATUS_PILL: Record<Sprint["status"], string> = {
  active: "green", planned: "blue", completed: "gray",
};

export function Sprints({ onChanged }: { onChanged: () => void }) {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");

  const load = () =>
    api<{ data: Sprint[] }>("/sprints").then((d) => setSprints(d.data));
  useEffect(() => { load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api("/sprints", {
      method: "POST",
      body: JSON.stringify({ name, goal: goal.trim() || null,
                             starts_on: starts || null,
                             ends_on: ends || null }),
    });
    setName(""); setGoal(""); setStarts(""); setEnds("");
    load(); onChanged();
  }

  async function setStatus(id: string, status: Sprint["status"]) {
    if (status === "completed"
        && !confirm("Complete this sprint? Unfinished tickets return to the "
                    + "backlog.")) return;
    await api(`/sprints/${id}`, { method: "PATCH",
                                  body: JSON.stringify({ status }) });
    load(); onChanged();
  }

  async function remove(id: string) {
    if (!confirm("Delete this sprint? Its tickets return to the backlog."))
      return;
    await api(`/sprints/${id}`, { method: "DELETE" });
    load(); onChanged();
  }

  return (
    <>
      <div className="card">
        <h2>New sprint</h2>
        <form onSubmit={create}
              style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input value={name} placeholder="Sprint name (e.g. Sprint 12)"
                 style={{ flex: "1 1 180px" }}
                 onChange={(e) => setName(e.target.value)} />
          <input value={goal} placeholder="Goal (optional)"
                 style={{ flex: "2 1 240px" }}
                 onChange={(e) => setGoal(e.target.value)} />
          <input type="date" value={starts} title="Start date"
                 onChange={(e) => setStarts(e.target.value)} />
          <input type="date" value={ends} title="End date"
                 onChange={(e) => setEnds(e.target.value)} />
          <button className="primary">Create sprint</button>
        </form>
      </div>

      <div className="card">
        <h2>Sprints ({sprints.length})</h2>
        {sprints.length === 0 && (
          <div className="empty">No sprints yet — create the first one above</div>
        )}
        {sprints.map((s) => (
          <div className="row" key={s.id}>
            <span className={`pill ${STATUS_PILL[s.status]}`}>{s.status}</span>
            <b>{s.name}</b>
            {s.goal && <span className="muted">{s.goal}</span>}
            <span className="muted">
              {s.starts_on ? s.starts_on.slice(0, 10) : "?"} →{" "}
              {s.ends_on ? s.ends_on.slice(0, 10) : "?"}
            </span>
            <span className="muted right">
              {s.done_count}/{s.ticket_count} tickets done
            </span>
            <a href={`#board/${s.id}`}><button>Board</button></a>
            {s.status === "planned" && (
              <button onClick={() => setStatus(s.id, "active")}>Start</button>
            )}
            {s.status === "active" && (
              <button onClick={() => setStatus(s.id, "completed")}>
                Complete</button>
            )}
            {s.ticket_count === 0 && s.status !== "active" && (
              <button onClick={() => remove(s.id)}>Delete</button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { api, Page, Ticket } from "../api";

const COLUMNS: Array<[string, string]> = [
  ["open", "Open"], ["in_progress", "In progress"], ["done", "Done"]];

export function Board({ onChanged }: { onChanged: () => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [title, setTitle] = useState("");

  const load = () =>
    api<Page<Ticket>>("/tickets?limit=200").then((d) => setTickets(d.data));
  useEffect(() => { load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api("/tickets", { method: "POST",
                            body: JSON.stringify({ title }) });
    setTitle("");
    load();
    onChanged();
  }

  return (
    <>
      <div className="card">
        <form onSubmit={create} style={{ display: "flex", gap: 10 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
                 placeholder="New ticket title" style={{ flex: 1 }} />
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
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

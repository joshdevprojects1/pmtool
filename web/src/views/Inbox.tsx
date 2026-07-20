import { useEffect, useState } from "react";
import { api, Page, Suggestion, Ticket } from "../api";
import { SuggestionRow } from "./SuggestionRow";

export function Inbox({ onChanged }: { onChanged: () => void }) {
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [tickets, setTickets] = useState<Map<string, Ticket>>(new Map());

  const load = () => Promise.all([
    api<Page<Suggestion>>("/suggestions?status=pending&limit=200"),
    api<Page<Ticket>>("/tickets?limit=200"),
  ]).then(([s, t]) => {
    setSugg(s.data);
    setTickets(new Map(t.data.map((x) => [x.id, x])));
  });
  useEffect(() => { load(); }, []);

  const byTicket = new Map<string, Suggestion[]>();
  for (const s of sugg) {
    const list = byTicket.get(s.ticket_id) ?? [];
    list.push(s);
    byTicket.set(s.ticket_id, list);
  }

  if (sugg.length === 0) {
    return <div className="card">
      <div className="empty">Inbox zero — no pending suggestions</div></div>;
  }
  return (
    <>
      {[...byTicket.entries()].map(([tid, list]) => {
        const t = tickets.get(tid);
        return (
          <div className="card" key={tid}>
            <h2>
              <a href={`#ticket/${tid}`}
                 style={{ color: "var(--accent)", textDecoration: "none" }}>
                {t ? `${t.key} — ${t.title}` : `ticket ${tid}`}
              </a>
            </h2>
            {list.sort((a, b) => Number(b.score) - Number(a.score))
                 .map((s) => (
              <SuggestionRow key={s.id} s={s}
                             onActed={() => { load(); onChanged(); }} />
            ))}
          </div>
        );
      })}
    </>
  );
}

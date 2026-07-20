import { useEffect, useState } from "react";
import { api, ChangeEvent, Page } from "../api";

export function Changes() {
  const [rows, setRows] = useState<ChangeEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  async function load(append: boolean) {
    const qs = append && cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const d = await api<Page<ChangeEvent>>(`/changes?limit=50${qs}`);
    setRows((prev) => (append ? [...prev, ...d.data] : d.data));
    setCursor(d.next_cursor);
  }
  useEffect(() => { load(false); }, []);

  return (
    <div className="card">
      <h2>Change ledger</h2>
      {rows.map((ce) => (
        <div className="row" key={ce.id}>
          <span className="pill blue mono" title="change event id">{ce.id.slice(0, 8)}…</span>
          <span className="mono">{ce.component_type}:{ce.api_name}</span>
          <span className="muted">
            {ce.operation} · {ce.org} · {ce.author_username ?? "?"} ·{" "}
            {ce.occurred_at.slice(0, 16)} · {ce.source}
          </span>
          <button className="right" style={{ fontSize: 12 }}
                  onClick={() => navigator.clipboard.writeText(ce.id)}>
            Copy id
          </button>
        </div>
      ))}
      {cursor && (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => load(true)}>Load more</button>
        </div>
      )}
    </div>
  );
}

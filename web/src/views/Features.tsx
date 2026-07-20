import { FormEvent, useEffect, useState } from "react";
import { api, Feature, Page } from "../api";

export function Features() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [name, setName] = useState("");

  const load = () =>
    api<Page<Feature>>("/features").then((d) => setFeatures(d.data));
  useEffect(() => { load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api("/features", { method: "POST",
                             body: JSON.stringify({ name: name.trim() }) });
    setName("");
    load();
  }

  return (
    <>
      <div className="card">
        <form onSubmit={create} style={{ display: "flex", gap: 10 }}>
          <input value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="New feature name" style={{ flex: 1 }} />
          <button className="primary">Create feature</button>
        </form>
      </div>
      {features.length === 0 && (
        <div className="card"><div className="empty">No features yet</div></div>
      )}
      {features.map((f) => (
        <div className="card" key={f.id} style={{ cursor: "pointer" }}
             onClick={() => { location.hash = `#feature/${f.id}`; }}>
          <div className="row">
            <h2 style={{ margin: 0 }}>{f.name}</h2>
            <span className="pill blue">{f.status}</span>
            <span className="muted right">
              {f.ticket_count} ticket{f.ticket_count === 1 ? "" : "s"}
            </span>
          </div>
          {f.description && <p className="muted">{f.description}</p>}
        </div>
      ))}
    </>
  );
}

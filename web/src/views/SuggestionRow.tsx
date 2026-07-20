import { api, Suggestion } from "../api";

export function SuggestionRow({ s, onActed }:
    { s: Suggestion; onActed: () => void }) {
  async function act(action: "accept" | "reject") {
    try { await api(`/suggestions/${s.id}/${action}`, { method: "POST" }); }
    catch (e: any) { alert(e.title ?? "Request failed"); }
    onActed();
  }
  const score = Number(s.score);
  return (
    <div className="row">
      <span className="mono">{s.component_type}:{s.api_name}</span>
      <span className="muted">
        {s.operation} · {s.author_username ?? "?"} ·{" "}
        {s.occurred_at.slice(0, 16)} · {s.source}
      </span>
      <span className="right score"
            style={{ color: score >= 0.8 ? "var(--good)" : "var(--warn)" }}>
        {score.toFixed(2)}
      </span>
      <button onClick={() => act("accept")}>Accept</button>
      <button onClick={() => act("reject")}>Reject</button>
      {s.signals.map((sig, i) => (
        <div className="why" key={i}>
          ↳ {sig.kind} ({sig.weight}): {sig.detail}
        </div>
      ))}
    </div>
  );
}

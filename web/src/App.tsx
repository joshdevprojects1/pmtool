import { useEffect, useState } from "react";
import { api, Page, Suggestion } from "./api";
import { Board } from "./views/Board";
import { TicketView } from "./views/Ticket";
import { Inbox } from "./views/Inbox";
import { Features } from "./views/Features";
import { FeatureView } from "./views/Feature";
import { Changes } from "./views/Changes";
import { Orgs } from "./views/Orgs";

function useHash(): string {
  const [hash, setHash] = useState(location.hash || "#board");
  useEffect(() => {
    const onChange = () => setHash(location.hash || "#board");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const [pending, setPending] = useState<number | null>(null);
  const [bump, setBump] = useState(0);
  const refresh = () => setBump((b) => b + 1);

  useEffect(() => {
    api<Page<Suggestion>>("/suggestions?status=pending&limit=200")
      .then((d) => setPending(d.data.length))
      .catch(() => setPending(null));
  }, [hash, bump]);

  const tabs: Array<[string, string]> = [
    ["#board", "Board"], ["#inbox", "Review inbox"],
    ["#features", "Features"], ["#changes", "Change ledger"],
    ["#orgs", "Orgs"]];

  let view = <Board key={bump} onChanged={refresh} />;
  if (hash.startsWith("#ticket/")) {
    view = <TicketView key={hash + bump} id={hash.split("/")[1]}
                       onChanged={refresh} />;
  } else if (hash.startsWith("#feature/")) {
    view = <FeatureView key={hash + bump} id={hash.split("/")[1]}
                        onChanged={refresh} />;
  } else if (hash === "#inbox") view = <Inbox key={bump} onChanged={refresh} />;
  else if (hash === "#features") view = <Features key={bump} />;
  else if (hash === "#changes") view = <Changes key={bump} />;
  else if (hash === "#orgs") view = <Orgs key={bump} />;

  return (
    <>
      <header>
        <b>pmtool</b>
        <nav>
          {tabs.map(([href, label]) => (
            <a key={href} href={href}
               className={hash.startsWith(href) ? "on" : ""}>{label}</a>
          ))}
        </nav>
        {pending !== null && (
          <span className="pending-pill">{pending} suggestions pending</span>
        )}
      </header>
      <main>{view}</main>
    </>
  );
}

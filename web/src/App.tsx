import { useEffect, useRef, useState } from "react";
import { api, initials, Page, SearchResults, Suggestion, User } from "./api";
import { Board } from "./views/Board";
import { TicketView } from "./views/Ticket";
import { Inbox } from "./views/Inbox";
import { Features } from "./views/Features";
import { FeatureView } from "./views/Feature";
import { Changes } from "./views/Changes";
import { Orgs } from "./views/Orgs";
import { Login } from "./views/Login";
import { Profile } from "./views/Profile";
import { Sprints } from "./views/Sprints";

type Theme = "light" | "dark";

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  const toggle = () =>
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, toggle };
}

function useHash(): string {
  const [hash, setHash] = useState(location.hash || "#board");
  useEffect(() => {
    const onChange = () => setHash(location.hash || "#board");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function SearchBox() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number>();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults(null); return; }
    timer.current = window.setTimeout(() => {
      api<SearchResults>(`/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => { setResults(r); setOpen(true); })
        .catch(() => setResults(null));
    }, 250);
    return () => window.clearTimeout(timer.current);
  }, [q]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (hash: string) => {
    location.hash = hash;
    setQ(""); setResults(null); setOpen(false);
  };

  const empty = results && results.tickets.length === 0
    && results.features.length === 0 && results.components.length === 0;

  return (
    <div className="search-wrap" ref={wrap}>
      <input className="search-box" value={q} placeholder="Search…  ✦"
             onFocus={() => results && setOpen(true)}
             onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
             onChange={(e) => setQ(e.target.value)} />
      {open && results && (
        <div className="search-pop">
          {empty && <div className="empty">No matches for “{q.trim()}”</div>}
          {results.tickets.length > 0 && (
            <div className="search-group">Tickets</div>)}
          {results.tickets.map((t) => (
            <div className="search-item" key={t.id}
                 onClick={() => go(`#ticket/${t.id}`)}>
              <span className="key">{t.key}</span> {t.title}
              <span className="muted right">{t.status}</span>
            </div>
          ))}
          {results.features.length > 0 && (
            <div className="search-group">Features</div>)}
          {results.features.map((f) => (
            <div className="search-item" key={f.id}
                 onClick={() => go(`#feature/${f.id}`)}>
              {f.name}
              <span className="muted right">{f.status}</span>
            </div>
          ))}
          {results.components.length > 0 && (
            <div className="search-group">Components</div>)}
          {results.components.map((c) => (
            <div className="search-item" key={c.id}
                 onClick={() => go("#changes")}>
              <span className="mono">{c.component_type}:{c.api_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu({ user, onLogout }:
    { user: User; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    onLogout();
  }

  return (
    <div className="user-wrap" ref={wrap}>
      <button className="avatar avatar-btn" title={user.display_name}
              onClick={() => setOpen((o) => !o)}>
        {initials(user.display_name)}
      </button>
      {open && (
        <div className="menu-pop">
          <div className="menu-head">
            <b>{user.display_name}</b>
            <div className="muted">{user.email}</div>
          </div>
          <div className="menu-item"
               onClick={() => { setOpen(false); location.hash = "#profile"; }}>
            Profile &amp; account
          </div>
          <div className="menu-item" onClick={signOut}>Sign out</div>
        </div>
      )}
    </div>
  );
}

export function App() {
  const hash = useHash();
  const { theme, toggle } = useTheme();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [pending, setPending] = useState<number | null>(null);
  const [bump, setBump] = useState(0);
  const refresh = () => setBump((b) => b + 1);

  useEffect(() => {
    api<User>("/auth/me").then(setUser).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("pmtool:unauthorized", onUnauthorized);
    return () =>
      window.removeEventListener("pmtool:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    if (!user) return;
    api<Page<Suggestion>>("/suggestions?status=pending&limit=200")
      .then((d) => setPending(d.data.length))
      .catch(() => setPending(null));
  }, [hash, bump, user]);

  if (user === undefined) {
    return <div className="empty" style={{ marginTop: 80 }}>Loading…</div>;
  }
  if (!user) return <Login onLogin={setUser} />;

  const tabs: Array<[string, string]> = [
    ["#board", "Board"], ["#sprints", "Sprints"],
    ["#inbox", "Review inbox"], ["#features", "Features"],
    ["#changes", "Change ledger"], ["#orgs", "Orgs"]];

  let view = <Board key={bump} onChanged={refresh} />;
  if (hash.startsWith("#board/")) {
    view = <Board key={hash + bump} sprintId={hash.split("/")[1]}
                  onChanged={refresh} />;
  } else if (hash.startsWith("#ticket/")) {
    view = <TicketView key={hash + bump} id={hash.split("/")[1]}
                       onChanged={refresh} />;
  } else if (hash.startsWith("#feature/")) {
    view = <FeatureView key={hash + bump} id={hash.split("/")[1]}
                        onChanged={refresh} />;
  } else if (hash === "#inbox") view = <Inbox key={bump} onChanged={refresh} />;
  else if (hash === "#features") view = <Features key={bump} />;
  else if (hash === "#changes") view = <Changes key={bump} />;
  else if (hash === "#orgs") view = <Orgs key={bump} />;
  else if (hash === "#sprints") view = <Sprints key={bump} onChanged={refresh} />;
  else if (hash === "#profile") {
    view = <Profile key={bump} user={user} onUserChanged={setUser} />;
  }

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
        <span className="header-right">
          <SearchBox />
          {pending !== null && pending > 0 && (
            <a href="#inbox" className="pending-pill">{pending} pending</a>
          )}
          <button className="theme-toggle" onClick={toggle}
                  title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <UserMenu user={user} onLogout={() => setUser(null)} />
        </span>
      </header>
      <main>{view}</main>
    </>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { api, initials, Invite, Page, Ticket, User } from "../api";

function linkFor(kind: "register" | "reset", token: string): string {
  return `${location.origin}${location.pathname}#${kind}/${token}`;
}

function CopyLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-link">
      <span className="muted">{label}</span>
      <input readOnly value={url} onFocus={(e) => e.target.select()} />
      <button onClick={() => {
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}>{copied ? "Copied ✓" : "Copy"}</button>
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next_, setNext] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(""); setError("");
    try {
      await api("/auth/password", {
        method: "POST",
        body: JSON.stringify({ current_password: current,
                               new_password: next_ }) });
      setCurrent(""); setNext("");
      setMsg("Password changed. Other sessions were signed out.");
    } catch (err: any) {
      setError(err?.detail || err?.title || "Change failed");
    }
  }

  return (
    <div className="card">
      <h2>Password</h2>
      <form onSubmit={submit}
            style={{ display: "flex", gap: 10, flexWrap: "wrap",
                     alignItems: "center" }}>
        <input type="password" value={current} placeholder="Current password"
               required autoComplete="current-password"
               onChange={(e) => setCurrent(e.target.value)} />
        <input type="password" value={next_} placeholder="New password (8+)"
               required minLength={8} autoComplete="new-password"
               onChange={(e) => setNext(e.target.value)} />
        <button className="primary">Change password</button>
        {msg && <span className="muted">{msg}</span>}
      </form>
      {error && <div className="form-error" style={{ marginTop: 8 }}>
        {error}</div>}
    </div>
  );
}

function Team({ me }: { me: User }) {
  const [members, setMembers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviteUrl, setInviteUrl] = useState("");
  const [resetUrl, setResetUrl] = useState<{ email: string; url: string }
    | null>(null);
  const [error, setError] = useState("");

  const load = () => Promise.all([
    api<{ data: User[] }>("/users"),
    api<{ data: Invite[] }>("/invites"),
  ]).then(([u, i]) => { setMembers(u.data); setInvites(i.data); });
  useEffect(() => { load(); }, []);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(""); setInviteUrl("");
    try {
      const inv = await api<Invite>("/invites", {
        method: "POST", body: JSON.stringify({ email, role }) });
      setInviteUrl(linkFor("register", inv.token!));
      setEmail("");
      load();
    } catch (err: any) {
      setError(err?.detail || err?.title || "Invite failed");
    }
  }

  async function revoke(id: string) {
    await api(`/invites/${id}`, { method: "DELETE" });
    load();
  }

  async function resetLink(u: User) {
    setError(""); setResetUrl(null);
    try {
      const r = await api<{ token: string }>(`/users/${u.id}/reset-link`, {
        method: "POST" });
      setResetUrl({ email: u.email, url: linkFor("reset", r.token) });
    } catch (err: any) {
      setError(err?.detail || err?.title || "Could not create reset link");
    }
  }

  return (
    <div className="card">
      <h2>Team</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Invite and reset links are shown once — copy them and send them
        yourself (no email is sent).
      </p>
      {members.map((u) => (
        <div className="row" key={u.id}>
          <span className="avatar">{initials(u.display_name)}</span>
          <b>{u.display_name}</b>
          <span className="muted">{u.email}</span>
          <span className="pill blue">{u.role}</span>
          {u.id !== me.id && (
            <button className="right" onClick={() => resetLink(u)}>
              Reset link</button>
          )}
        </div>
      ))}
      {resetUrl && (
        <CopyLink label={`Password reset for ${resetUrl.email} (24h):`}
                  url={resetUrl.url} />
      )}

      <h2 style={{ marginTop: 18 }}>Invites</h2>
      {invites.length === 0 && (
        <div className="empty">No open invites</div>
      )}
      {invites.map((i) => (
        <div className="row" key={i.id}>
          <span className="muted">{i.email}</span>
          <span className="pill blue">{i.role}</span>
          <span className="muted">
            expires {i.expires_at.slice(0, 10)}</span>
          <button className="right" onClick={() => revoke(i.id)}>Revoke</button>
        </div>
      ))}
      <form onSubmit={invite}
            style={{ display: "flex", gap: 10, flexWrap: "wrap",
                     marginTop: 10 }}>
        <input type="email" value={email} placeholder="teammate@company.com"
               required style={{ flex: "1 1 220px" }}
               onChange={(e) => setEmail(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">member</option>
          <option value="admin">admin</option>
          <option value="viewer">viewer</option>
        </select>
        <button className="primary">Create invite link</button>
      </form>
      {inviteUrl && (
        <CopyLink label="Invite link (14 days):" url={inviteUrl} />
      )}
      {error && <div className="form-error" style={{ marginTop: 8 }}>
        {error}</div>}
    </div>
  );
}

export function Profile({ user, onUserChanged }:
    { user: User; onUserChanged: (u: User) => void }) {
  const [name, setName] = useState(user.display_name);
  const [sfUsers, setSfUsers] = useState(user.sf_usernames.join(", "));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [mine, setMine] = useState<Ticket[]>([]);

  useEffect(() => {
    api<Page<Ticket>>(`/tickets?assignee_id=${user.id}&limit=100`)
      .then((d) => setMine(d.data)).catch(() => setMine([]));
  }, [user.id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(""); setSaved(false);
    try {
      const u = await api<User>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: name,
          sf_usernames: sfUsers.split(",").map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      onUserChanged({ ...user, display_name: u.display_name,
                      sf_usernames: u.sf_usernames });
      setSaved(true);
    } catch (err: any) {
      setError(err?.detail || err?.title || "Save failed");
    }
  }

  const open = mine.filter((t) => t.status !== "done");
  const done = mine.filter((t) => t.status === "done");

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="avatar avatar-lg">{initials(name || "?")}</span>
          <div>
            <h2 style={{ margin: 0 }}>{user.display_name}</h2>
            <div className="muted">{user.email} · {user.role}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Profile</h2>
        <form onSubmit={save}
              style={{ display: "flex", flexDirection: "column", gap: 10,
                       maxWidth: 480 }}>
          <label className="muted">Display name
            <input value={name} style={{ display: "block", width: "100%",
                                         marginTop: 4 }}
                   onChange={(e) => { setName(e.target.value);
                                      setSaved(false); }} />
          </label>
          <label className="muted">
            Salesforce usernames (comma-separated) — used to attribute your
            changes and deployments
            <input value={sfUsers} style={{ display: "block", width: "100%",
                                            marginTop: 4 }}
                   placeholder="josh@company.com.uat, josh@company.com"
                   onChange={(e) => { setSfUsers(e.target.value);
                                      setSaved(false); }} />
          </label>
          {error && <div className="form-error">{error}</div>}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="primary">Save profile</button>
            {saved && <span className="muted">Saved ✓</span>}
          </div>
        </form>
      </div>

      <ChangePassword />
      {user.role === "admin" && <Team me={user} />}

      <div className="card">
        <h2>My tickets ({open.length} open)</h2>
        {mine.length === 0 && (
          <div className="empty">Nothing assigned to you yet</div>
        )}
        {open.concat(done).map((t) => (
          <div className="row" key={t.id}>
            <span className="key">{t.key}</span>
            <a href={`#ticket/${t.id}`}>{t.title}</a>
            <span className={`pill right ${
              t.status === "done" ? "green" : "blue"}`}>{t.status}</span>
          </div>
        ))}
      </div>
    </>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { api, User } from "../api";

interface InvitePreview { email: string; role: string; workspace_name: string; }

// Pre-auth deep links: #register/<invite-token>, #reset/<reset-token>.
function tokenFromHash(prefix: string): string | null {
  return location.hash.startsWith(prefix)
    ? location.hash.slice(prefix.length) : null;
}

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const inviteToken = tokenFromHash("#register/");
  const resetToken = tokenFromHash("#reset/");
  const [mode, setMode] = useState<"login" | "register" | "reset">(
    resetToken ? "reset" : inviteToken ? "register" : "login");
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [wsName, setWsName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    api<InvitePreview>(`/auth/invite/${inviteToken}`)
      .then((i) => { setInvite(i); setEmail(i.email); })
      .catch((e) => setError(e?.detail || "This invite is invalid or expired"));
  }, [inviteToken]);

  function done(user: User) {
    location.hash = "#board";
    onLogin(user);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "reset") {
        done(await api<User>("/auth/reset", {
          method: "POST",
          body: JSON.stringify({ token: resetToken, password }) }));
      } else if (mode === "register") {
        done(await api<User>("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email, password,
            display_name: name.trim() || undefined,
            invite_token: inviteToken ?? undefined,
            workspace_name: inviteToken ? undefined
              : wsName.trim() || undefined,
          }) }));
      } else {
        done(await api<User>("/auth/login", {
          method: "POST", body: JSON.stringify({ email, password }) }));
      }
    } catch (err: any) {
      setError(err?.detail || err?.title || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="login-brand">✦ pmtool</div>
        <p className="muted" style={{ marginTop: 0 }}>
          {mode === "login" && "Welcome back. Sign in to your workspace."}
          {mode === "register" && (invite
            ? <>You&apos;ve been invited to <b>{invite.workspace_name}</b> as
                a {invite.role}.</>
            : "Create an account and your own workspace.")}
          {mode === "reset" && "Choose a new password."}
        </p>
        <form onSubmit={submit}
              style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "register" && (
            <input value={name} placeholder="Display name"
                   onChange={(e) => setName(e.target.value)} />
          )}
          {mode !== "reset" && (
            <input type="email" value={email} placeholder="Email" required
                   autoComplete="email" disabled={!!invite}
                   onChange={(e) => setEmail(e.target.value)} />
          )}
          {mode === "register" && !inviteToken && (
            <input value={wsName} placeholder="Workspace name (optional)"
                   onChange={(e) => setWsName(e.target.value)} />
          )}
          <input type="password" value={password}
                 placeholder={mode === "login" ? "Password" : "New password"}
                 required minLength={mode === "login" ? undefined : 8}
                 autoComplete={mode === "login"
                   ? "current-password" : "new-password"}
                 onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="form-error">{error}</div>}
          <button className="primary" disabled={busy}>
            {busy ? "…"
              : mode === "login" ? "Sign in"
              : mode === "reset" ? "Set new password" : "Create account"}
          </button>
        </form>
        <div className="muted" style={{ marginTop: 14, textAlign: "center" }}>
          {mode === "login" && (
            <>No account?{" "}
              <a href="#" onClick={(e) => { e.preventDefault();
                setError(""); setMode("register"); }}>Register</a>
              <div style={{ marginTop: 6 }}>
                Forgot your password? Ask a workspace admin for a reset link.
              </div></>
          )}
          {mode !== "login" && (
            <>Already registered?{" "}
              <a href="#" onClick={(e) => { e.preventDefault();
                setError(""); setMode("login"); }}>Sign in</a></>
          )}
        </div>
      </div>
    </div>
  );
}

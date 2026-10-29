"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Boxes, ShieldCheck } from "lucide-react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Sign in failed.");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-story">
        <Link className="brand brand-light" href="/" aria-label="Campus Resource home">
          <span className="brand-icon"><Boxes size={22} /></span>
          <span>Campus<span className="brand-soft">Flow</span></span>
        </Link>
        <div className="story-copy">
          <span className="eyebrow eyebrow-light">SMARTER CAMPUS OPERATIONS</span>
          <h1>Make every resource<br />go further.</h1>
          <p>See what is available across campus, move surplus where it is needed, and make procurement the last resort.</p>
        </div>
        <div className="login-proof">
          <div className="proof-icon"><ShieldCheck size={18} /></div>
          <div><strong>Built for accountable allocation</strong><span>Role-aware access · Transaction-safe transfers</span></div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-form-wrap">
          <span className="eyebrow">WELCOME BACK</span>
          <h2>Sign in to your workspace</h2>
          <p className="muted">Sign in with your administrator, staff, or student campus account.</p>
          <form className="form-stack login-form" onSubmit={submit}>
            <label>Email address<input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} placeholder="you@campus.edu" /></label>
            <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={128} placeholder="Enter your password" /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-primary button-wide" disabled={busy} type="submit">
              {busy ? "Signing in..." : "Sign in"} <ArrowRight size={16} />
            </button>
          </form>
          <p className="login-footnote">Administrator, staff, and student accounts are created by your project administrator.</p>
        </div>
      </section>
    </main>
  );
}

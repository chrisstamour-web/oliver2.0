"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const BRAND = "#49257a";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.2 6.2 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.1-.1-2.2-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.3 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.2 6.2 29.3 4 24 4c-7.7 0-14.4 4.3-17.7 10.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.4 35.6 26.8 36 24 36c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.3 39.7 16.1 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1.1 3-3.2 5.2-5.9 6.6l.0 0 6.3 5.2C39.2 36.7 44 31.3 44 24c0-1.1-.1-2.2-.4-3.5z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#F25022" d="M2 2h9v9H2z" />
      <path fill="#7FBA00" d="M13 2h9v9h-9z" />
      <path fill="#00A4EF" d="M2 13h9v9H2z" />
      <path fill="#FFB900" d="M13 13h9v9h-9z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

const callbackUrl = useMemo(() => {
  if (typeof window === "undefined") return "/auth/callback";
  return `${window.location.origin}/auth/callback`;
}, []);


  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (error) return setError(error.message);

    router.push("/");
    router.refresh();
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signUp({ email, password });

    setLoading(false);
    if (error) return setError(error.message);

    alert("Account created. If email confirmation is enabled, check your inbox.");
  }

  async function signInWithGoogle() {
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl },
    });

    if (error) setError(error.message);
    setLoading(false);
  }

  async function signInWithMicrosoft() {
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: { redirectTo: callbackUrl },
    });

    if (error) setError(error.message);
    setLoading(false);
  }

  const inputStyle: React.CSSProperties = {
    border: "1px solid #ddd",
    padding: 10,
    borderRadius: 10,
    outline: "none",
  };

  const btn: React.CSSProperties = {
    padding: 10,
    borderRadius: 12,
    border: "1px solid #ddd",
    fontWeight: 800,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  };

  return (
    <main style={{ maxWidth: 420, margin: "56px auto", padding: 16 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <img
          src="/logo.png"
          alt="Oliver"
          width={34}
          height={34}
          style={{ borderRadius: 10 }}
        />
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: BRAND }}>Oliver 2.0</div>
          <div style={{ fontSize: 13, opacity: 0.75 }}>Sign in to continue</div>
        </div>
      </header>

      <div style={{ border: "1px solid #e7e7e7", borderRadius: 16, padding: 16 }}>
        <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={loading}
            style={{ ...btn, background: "white", color: "#111" }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <button
            type="button"
            onClick={signInWithMicrosoft}
            disabled={loading}
            style={{ ...btn, background: "white", color: "#111" }}
          >
            <MicrosoftIcon />
            Continue with Microsoft
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 0 14px" }}>
          <div style={{ height: 1, background: "#eee", flex: 1 }} />
          <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 700 }}>or</div>
          <div style={{ height: 1, background: "#eee", flex: 1 }} />
        </div>

        <form onSubmit={signIn} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = BRAND)}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#ddd")}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = BRAND)}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#ddd")}
            />
          </label>

          {error ? (
            <div
              style={{
                border: "1px solid rgba(220, 20, 60, 0.25)",
                background: "rgba(220, 20, 60, 0.06)",
                color: "crimson",
                padding: 10,
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            style={{
              ...btn,
              borderColor: BRAND,
              background: BRAND,
              color: "white",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Working..." : "Sign in"}
          </button>

          <button
            type="button"
            onClick={signUp}
            disabled={loading}
            style={{
              ...btn,
              background: "white",
              color: BRAND,
              borderColor: "#ddd",
              opacity: loading ? 0.7 : 1,
            }}
          >
            Create account
          </button>
        </form>
      </div>
    </main>
  );
}

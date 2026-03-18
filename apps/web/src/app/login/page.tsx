"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CREDENTIALS = [
  { username: "admin",         password: "admin123",         role: "admin" },
  { username: "manager",       password: "manager123",       role: "manager" },
  { username: "investigator",  password: "investigator123",  role: "investigator" },
];

const ROLE_COLOR: Record<string, string> = {
  admin:        "#f87171",
  manager:      "#fbbf24",
  investigator: "#38bdf8",
};

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [focusedField, setFocused] = useState<string | null>(null);

  async function handleLogin() {
    if (!username || !password || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.detail ?? "Invalid credentials");
        return;
      }
      const data = await res.json();
      localStorage.setItem("access_token",  data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      localStorage.setItem("user",          JSON.stringify(data.user));
      router.push("/");
    } catch {
      setError("Connection failed. Is the API running?");
    } finally {
      setLoading(false);
    }
  }

  function quickFill(u: string, p: string) {
    setUsername(u);
    setPassword(p);
    setError("");
  }

  const canSubmit = !loading && username.trim() && password.trim();

  return (
    <div style={{
      minHeight: "100vh",
      background: "#09091a",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', monospace",
      position: "relative", overflow: "hidden",
    }}>
      {/* Background grid */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: `
          linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
      }} />

      {/* Glow blobs */}
      <div style={{ position: "absolute", top: "20%", left: "15%", width: 300, height: 300, background: "#1d4ed8", borderRadius: "50%", filter: "blur(120px)", opacity: 0.08, pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "20%", right: "15%", width: 250, height: 250, background: "#4f46e5", borderRadius: "50%", filter: "blur(100px)", opacity: 0.08, pointerEvents: "none" }} />

      <div style={{ width: 420, position: "relative", zIndex: 1 }}>

        {/* Logo + title */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: "linear-gradient(135deg, #1d4ed8, #4f46e5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, margin: "0 auto 16px",
            boxShadow: "0 8px 32px #3b82f640",
          }}>🛡</div>
          <h1 style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em" }}>
            FraudGuard <span style={{ color: "#3b82f6" }}>AI</span>
          </h1>
          <p style={{ color: "#374151", fontSize: 12, margin: 0, letterSpacing: "0.05em" }}>
            INSURANCE FRAUD DETECTION PLATFORM
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "#0c0c1e",
          border: "1px solid #1a1a30",
          borderRadius: 18, padding: "32px 32px 28px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}>
          <p style={{ color: "#374151", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 20px" }}>
            Sign in to continue
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Username */}
            <div>
              <label style={{ color: "#4b5563", fontSize: 10, fontWeight: 700, display: "block", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Username
              </label>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                onFocus={() => setFocused("username")}
                onBlur={() => setFocused(null)}
                placeholder="Enter username"
                autoComplete="username"
                style={{
                  width: "100%", background: "#09091a",
                  border: `1px solid ${focusedField === "username" ? "#3b82f6" : "#1a1a30"}`,
                  borderRadius: 10, padding: "11px 14px", color: "#f1f5f9",
                  fontSize: 13, boxSizing: "border-box", outline: "none",
                  fontFamily: "inherit", transition: "border-color 0.15s",
                }}
              />
            </div>

            {/* Password */}
            <div>
              <label style={{ color: "#4b5563", fontSize: 10, fontWeight: 700, display: "block", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                onFocus={() => setFocused("password")}
                onBlur={() => setFocused(null)}
                placeholder="Enter password"
                autoComplete="current-password"
                style={{
                  width: "100%", background: "#09091a",
                  border: `1px solid ${focusedField === "password" ? "#3b82f6" : "#1a1a30"}`,
                  borderRadius: 10, padding: "11px 14px", color: "#f1f5f9",
                  fontSize: 13, boxSizing: "border-box", outline: "none",
                  fontFamily: "inherit", transition: "border-color 0.15s",
                }}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: "#f8717110", border: "1px solid #f8717130",
                borderRadius: 8, padding: "9px 12px",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ fontSize: 13 }}>⚠️</span>
                <p style={{ color: "#f87171", fontSize: 12, margin: 0 }}>{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleLogin}
              disabled={!canSubmit}
              style={{
                background: canSubmit
                  ? "linear-gradient(135deg, #1d4ed8, #4f46e5)"
                  : "#1a1a30",
                color: canSubmit ? "#fff" : "#374151",
                border: "none", borderRadius: 10,
                padding: "12px", fontSize: 13, fontWeight: 700,
                cursor: canSubmit ? "pointer" : "not-allowed",
                marginTop: 4, fontFamily: "inherit",
                boxShadow: canSubmit ? "0 4px 16px #3b82f640" : "none",
                transition: "all 0.2s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
              onMouseEnter={e => { if (canSubmit) (e.currentTarget as HTMLButtonElement).style.opacity = "0.88"; }}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = "1"}
            >
              {loading ? (
                <>
                  <div style={{
                    width: 14, height: 14, borderRadius: "50%",
                    border: "2px solid #ffffff44", borderTopColor: "#fff",
                    animation: "spin 0.8s linear infinite",
                  }} />
                  Signing in...
                  <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                </>
              ) : "Sign In →"}
            </button>
          </div>
        </div>

        {/* Quick-fill credentials */}
        <div style={{
          marginTop: 14,
          background: "#0c0c1e", border: "1px solid #1a1a30",
          borderRadius: 14, padding: "16px 20px",
        }}>
          <p style={{ color: "#374151", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 10px" }}>
            Demo Credentials
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {CREDENTIALS.map(({ username: u, password: p, role }) => (
              <button
                key={u}
                onClick={() => quickFill(u, p)}
                style={{
                  background: "transparent", border: "1px solid #1a1a30",
                  borderRadius: 8, padding: "8px 12px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = ROLE_COLOR[role] + "44";
                  (e.currentTarget as HTMLButtonElement).style.background = ROLE_COLOR[role] + "08";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#1a1a30";
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%",
                    background: ROLE_COLOR[role] + "18",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 800, color: ROLE_COLOR[role],
                  }}>{u[0].toUpperCase()}</div>
                  <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>{u}</span>
                  <span style={{ color: "#374151", fontSize: 11 }}>/ {p}</span>
                </div>
                <span style={{
                  background: ROLE_COLOR[role] + "18", color: ROLE_COLOR[role],
                  borderRadius: 5, padding: "1px 8px", fontSize: 10, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: "0.05em",
                }}>{role}</span>
              </button>
            ))}
          </div>
          <p style={{ color: "#1f2937", fontSize: 10, margin: "10px 0 0", textAlign: "center" }}>
            Click any row to auto-fill credentials
          </p>
        </div>

      </div>
    </div>
  );
}
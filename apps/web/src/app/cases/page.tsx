"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getUser, logout } from "@/lib/auth";

type Case = {
  case_id:        string;
  claim_id:       string;
  status:         string;
  priority:       string;
  assigned_to:    string;
  notes:          string;
  decision:       string;
  created_at:     string;
  updated_at:     string;
  claim_amount:   number;
  claim_type:     string;
  fraud_scenario: string;
  label_is_fraud: number;
};

const STATUS_META: Record<string, { color: string; bg: string }> = {
  OPEN:            { color: "#38bdf8", bg: "#38bdf810" },
  IN_REVIEW:       { color: "#fbbf24", bg: "#fbbf2410" },
  CONFIRMED_FRAUD: { color: "#f87171", bg: "#f8717110" },
  DISMISSED:       { color: "#34d399", bg: "#34d39910" },
};

const PRIORITY_META: Record<string, { color: string }> = {
  CRITICAL: { color: "#f87171" },
  HIGH:     { color: "#fb923c" },
  MEDIUM:   { color: "#fbbf24" },
  LOW:      { color: "#34d399" },
};

const TYPE_META: Record<string, { color: string; icon: string }> = {
  AUTO:   { color: "#38bdf8", icon: "🚗" },
  HOME:   { color: "#34d399", icon: "🏠" },
  HEALTH: { color: "#a78bfa", icon: "🏥" },
  LIFE:   { color: "#fbbf24", icon: "💛" },
};

function fmt(n: number | null) {
  if (n == null) return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0 });
}

function Badge({ label, color, bg }: { label: string; color: string; bg?: string }) {
  return (
    <span style={{
      background: bg ?? color + "18",
      border: `1px solid ${color}33`,
      color, borderRadius: 7,
      padding: "3px 10px", fontSize: 11, fontWeight: 700,
      whiteSpace: "nowrap", letterSpacing: "0.03em",
    }}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

export default function CasesPage() {
  const router = useRouter();
  const [cases, setCases]         = useState<Case[]>([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatus] = useState("ALL");
  const [mounted, setMounted]     = useState(false);
  const user = getUser();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setLoading(true);
    const params = statusFilter !== "ALL" ? `?status=${statusFilter}` : "";
    apiGet<Case[]>(`/cases${params}`)
      .then(setCases)
      .catch(() => setCases([]))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const counts = {
    ALL:             cases.length,
    OPEN:            cases.filter(c => c.status === "OPEN").length,
    IN_REVIEW:       cases.filter(c => c.status === "IN_REVIEW").length,
    CONFIRMED_FRAUD: cases.filter(c => c.status === "CONFIRMED_FRAUD").length,
    DISMISSED:       cases.filter(c => c.status === "DISMISSED").length,
  };

  return (
    <div style={{
      display: "flex", minHeight: "100vh",
      background: "#09091a",
      fontFamily: "'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', monospace",
      color: "#e2e8f0",
    }}>

      {/* ── SIDEBAR ── */}
      <aside style={{
        width: 220, flexShrink: 0, background: "#0c0c1e",
        borderRight: "1px solid #1a1a30",
        display: "flex", flexDirection: "column",
        position: "sticky", top: 0, height: "100vh",
      }}>
        {/* Logo */}
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #1a1a30" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "linear-gradient(135deg, #1d4ed8, #4f46e5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, boxShadow: "0 4px 16px #3b82f630",
            }}>🛡</div>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em" }}>FraudGuard</p>
              <p style={{ margin: 0, fontSize: 10, color: "#3b82f6", fontWeight: 600, letterSpacing: "0.06em" }}>AI PLATFORM</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
          {[
            { icon: "◈", label: "Overview", path: "/" },
            { icon: "◉", label: "Patterns", path: "/?section=patterns" },
          ].map(({ icon, label, path }) => (
            <button key={label} onClick={() => router.push(path)} style={{
              background: "transparent", border: "1px solid transparent",
              borderRadius: 9, padding: "9px 12px",
              color: "#4b5563", fontSize: 13, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 9, textAlign: "left",
              transition: "all 0.15s", fontFamily: "inherit",
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#4b5563"; }}
            >
              <span style={{ fontSize: 16 }}>{icon}</span> {label}
            </button>
          ))}

          <div style={{ margin: "8px 0", borderTop: "1px solid #1a1a30" }} />

          <button style={{
            background: "#1e3a5f", border: "1px solid #2563eb44",
            borderRadius: 9, padding: "9px 12px",
            color: "#60a5fa", fontSize: 13, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 9, textAlign: "left",
            fontFamily: "inherit",
          }}>
            <span style={{ fontSize: 16 }}>🗂</span> Cases
          </button>
        </nav>

        {/* User */}
        {mounted && user && (
          <div style={{ padding: "14px", borderTop: "1px solid #1a1a30" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "linear-gradient(135deg, #1d4ed8, #4f46e5)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0,
              }}>{user.username[0].toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <p style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 600, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.username}
                </p>
                <p style={{ color: "#1d4ed8", fontSize: 10, margin: 0, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
                  {user.role}
                </p>
              </div>
            </div>
            <button onClick={logout} style={{
              width: "100%", padding: "7px", borderRadius: 8,
              background: "transparent", border: "1px solid #1a1a30",
              color: "#4b5563", fontSize: 11, cursor: "pointer", fontWeight: 600,
              fontFamily: "inherit", transition: "all 0.15s",
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#ef444433"; (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#1a1a30"; (e.currentTarget as HTMLButtonElement).style.color = "#4b5563"; }}
            >Sign Out</button>
          </div>
        )}
      </aside>

      {/* ── MAIN ── */}
      <main style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>

        {/* Top bar */}
        <header style={{
          borderBottom: "1px solid #1a1a30", padding: "0 28px",
          height: 56, display: "flex", alignItems: "center",
          justifyContent: "space-between", background: "#09091acc",
          backdropFilter: "blur(12px)",
          position: "sticky", top: 0, zIndex: 50,
        }}>
          <div>
            <span style={{ color: "#4b5563", fontSize: 12 }}>Dashboard /&nbsp;</span>
            <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>Investigation Cases</span>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#0d2c1a", border: "1px solid #166534",
            borderRadius: 8, padding: "4px 12px",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block", boxShadow: "0 0 8px #22c55e" }} />
            <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}>LIVE</span>
          </div>
        </header>

        <div style={{ padding: "28px 28px 80px" }}>

          {/* Page title */}
          <div style={{ marginBottom: 24 }}>
            <p style={{ color: "#3b82f6", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 4px" }}>
              Case Management
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: "#f1f5f9", letterSpacing: "-0.025em" }}>
                Investigation Cases
              </h1>
              <span style={{
                background: "#38bdf818", border: "1px solid #38bdf833",
                color: "#38bdf8", borderRadius: 8,
                padding: "3px 12px", fontSize: 12, fontWeight: 700,
              }}>{counts.ALL} total</span>
            </div>
          </div>

          {/* Status filter tabs */}
          <div style={{
            display: "flex", gap: 6, marginBottom: 20,
            background: "#0c0c1e", border: "1px solid #1a1a30",
            borderRadius: 12, padding: 6, width: "fit-content",
          }}>
            {(["ALL", "OPEN", "IN_REVIEW", "CONFIRMED_FRAUD", "DISMISSED"] as const).map(s => {
              const active = statusFilter === s;
              const meta   = STATUS_META[s];
              const color  = meta?.color ?? "#6b7280";
              return (
                <button key={s} onClick={() => setStatus(s)} style={{
                  background: active ? color + "18" : "transparent",
                  border: `1px solid ${active ? color + "44" : "transparent"}`,
                  color: active ? color : "#4b5563",
                  borderRadius: 8, padding: "6px 14px", fontSize: 12,
                  fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  transition: "all 0.15s", whiteSpace: "nowrap",
                }}>
                  {s.replace(/_/g, " ")}
                  <span style={{
                    marginLeft: 6,
                    background: active ? color + "25" : "#1a1a30",
                    color: active ? color : "#374151",
                    borderRadius: 4, padding: "0 5px", fontSize: 10, fontWeight: 700,
                  }}>{counts[s] ?? 0}</span>
                </button>
              );
            })}
          </div>

          {/* Content */}
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...Array(4)].map((_, i) => (
                <div key={i} style={{
                  height: 52, borderRadius: 10,
                  background: "linear-gradient(90deg, #0c0c1e 25%, #141428 50%, #0c0c1e 75%)",
                  backgroundSize: "200% 100%",
                  animation: "shimmer 1.4s infinite",
                }} />
              ))}
              <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
            </div>
          ) : cases.length === 0 ? (
            <div style={{
              background: "#0c0c1e", border: "1px solid #1a1a30",
              borderRadius: 14, padding: "64px 24px", textAlign: "center",
            }}>
              <p style={{ fontSize: 36, margin: "0 0 12px" }}>◌</p>
              <p style={{ color: "#4b5563", fontSize: 14, margin: 0, fontWeight: 600 }}>No cases found</p>
              <p style={{ color: "#374151", fontSize: 12, margin: "6px 0 0" }}>
                Open a case from any claim detail page.
              </p>
            </div>
          ) : (
            <div style={{
              background: "#0c0c1e", border: "1px solid #1a1a30",
              borderRadius: 14, overflow: "hidden",
            }}>
              {/* Table header */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1.6fr 1.4fr 0.8fr 1fr 1.6fr 1fr 1.4fr 1.1fr 0.9fr",
                padding: "11px 20px", background: "#09091a",
                borderBottom: "1px solid #1a1a30", gap: 8, alignItems: "center",
              }}>
                {["Case ID", "Claim", "Type", "Amount", "Scenario", "Priority", "Status", "Assigned To", "Opened"].map(h => (
                  <span key={h} style={{
                    color: "#374151", fontSize: 10, fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: "0.08em",
                  }}>{h}</span>
                ))}
              </div>

              {/* Rows */}
              {cases.map((c, i) => {
                const typeM     = TYPE_META[c.claim_type]     ?? { color: "#6b7280", icon: "?" };
                const statusM   = STATUS_META[c.status]       ?? { color: "#6b7280", bg: "#6b728010" };
                const priorityM = PRIORITY_META[c.priority]   ?? { color: "#6b7280" };
                const isConf    = c.label_is_fraud === 1;

                return (
                  <div
                    key={c.case_id}
                    onClick={() => router.push(`/claim/${c.claim_id}`)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.6fr 1.4fr 0.8fr 1fr 1.6fr 1fr 1.4fr 1.1fr 0.9fr",
                      padding: "13px 20px", cursor: "pointer", gap: 8, alignItems: "center",
                      borderBottom: i < cases.length - 1 ? "1px solid #0f0f1e" : "none",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "#12122a"}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
                  >
                    {/* Case ID */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{
                        width: 4, height: 32, borderRadius: 2, flexShrink: 0,
                        background: isConf ? "#ef4444" : "#f59e0b",
                        boxShadow: `0 0 8px ${isConf ? "#ef444466" : "#f59e0b66"}`,
                      }} />
                      <span style={{ color: "#6b7280", fontSize: 11, fontWeight: 600 }}>{c.case_id}</span>
                    </div>

                    {/* Claim ID */}
                    <span style={{ color: "#60a5fa", fontSize: 12, fontWeight: 700 }}>{c.claim_id}</span>

                    {/* Type */}
                    <span style={{
                      background: typeM.color + "18", color: typeM.color,
                      borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700,
                      display: "inline-flex", alignItems: "center", gap: 3,
                    }}>
                      {typeM.icon} {c.claim_type ?? "—"}
                    </span>

                    {/* Amount */}
                    <span style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 700 }}>{fmt(c.claim_amount)}</span>

                    {/* Scenario */}
                    <span style={{ color: "#6b7280", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.fraud_scenario ? c.fraud_scenario.replace(/_/g, " ") : "—"}
                    </span>

                    {/* Priority */}
                    <Badge label={c.priority} color={priorityM.color} />

                    {/* Status */}
                    <Badge label={c.status} color={statusM.color} bg={statusM.bg} />

                    {/* Assigned to */}
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>{c.assigned_to}</span>

                    {/* Opened */}
                    <span style={{ color: "#374151", fontSize: 11 }}>
                      {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getUser, logout } from "@/lib/auth";
import PatternsPanel from "./PatternsPanel";
import ChatWidget from "./ChatWidget";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────
type FlaggedClaim = {
  claim_id: string;
  claim_type: string | null;
  claim_amount: number | null;
  label_is_fraud: number;
  fraud_scenario: string | null;
  days_to_file: number | null;
  filed_date: string | null;
  status: string | null;
  policyholder_id: string | null;
  bank_account_id: string | null;
  adjuster_id: string | null;
};
type FilterType      = "all" | "confirmed" | "potential";
type ClaimTypeFilter = "all" | "AUTO" | "HOME" | "HEALTH" | "LIFE";
type SortField       = "amount" | "days" | "claim_id";
type SortDir         = "asc" | "desc";

// ─── Constants ────────────────────────────────────────────────────────────────
const TYPE_META: Record<string, { color: string; icon: string; label: string }> = {
  AUTO:   { color: "#38bdf8", icon: "🚗", label: "Auto"   },
  HOME:   { color: "#34d399", icon: "🏠", label: "Home"   },
  HEALTH: { color: "#a78bfa", icon: "🏥", label: "Health" },
  LIFE:   { color: "#fbbf24", icon: "💛", label: "Life"   },
};
const STATUS_META: Record<string, { color: string; bg: string }> = {
  OPEN:             { color: "#38bdf8", bg: "#38bdf810" },
  IN_REVIEW:        { color: "#fbbf24", bg: "#fbbf2410" },
  CONFIRMED_FRAUD:  { color: "#f87171", bg: "#f8717110" },
  DISMISSED:        { color: "#4b5563", bg: "#4b556310" },
};
const SCENARIO_COLORS = ["#f87171", "#fb923c", "#fbbf24", "#34d399", "#38bdf8"];

function fmt(n: number | null) {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtM(n: number) {
  return "$" + (n / 1_000_000).toFixed(2) + "M";
}
function relativeDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Mini sparkline bar used in KPI cards ────────────────────────────────────
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ height: 3, background: "#ffffff0a", borderRadius: 2, overflow: "hidden", marginTop: 2 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.6s ease" }} />
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, color, icon, pct, trend,
}: {
  label: string; value: string | number; sub?: string;
  color: string; icon: string; pct?: number; trend?: "up" | "down" | "neutral";
}) {
  return (
    <div style={{
      background: "linear-gradient(145deg, #141428 0%, #0e0e20 100%)",
      border: `1px solid ${color}22`,
      borderRadius: 16, padding: "20px 22px", flex: 1, minWidth: 170,
      position: "relative", overflow: "hidden", cursor: "default",
      transition: "border-color 0.2s, transform 0.15s",
    }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = color + "55";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = color + "22";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
      }}
    >
      {/* Glow blob */}
      <div style={{
        position: "absolute", top: -20, right: -20, width: 80, height: 80,
        background: color, borderRadius: "50%", filter: "blur(40px)", opacity: 0.12,
        pointerEvents: "none",
      }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <span style={{
          color: "#94a3b8", fontSize: 11, fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.1em",
        }}>{label}</span>
        <span style={{
          width: 32, height: 32, borderRadius: 9, background: color + "18",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          flexShrink: 0,
        }}>{icon}</span>
      </div>
      <p style={{ color: "#f1f5f9", fontSize: 30, fontWeight: 800, margin: "0 0 4px", letterSpacing: "-0.03em", lineHeight: 1 }}>
        {value}
      </p>
      {sub && (
        <p style={{ color: "#4b5563", fontSize: 11, margin: "4px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
          {trend === "up"      && <span style={{ color: "#f87171" }}>↑</span>}
          {trend === "down"    && <span style={{ color: "#34d399" }}>↓</span>}
          {trend === "neutral" && <span style={{ color: "#4b5563" }}>→</span>}
          {sub}
        </p>
      )}
      {pct !== undefined && <MiniBar value={pct} max={100} color={color} />}
    </div>
  );
}

// ─── Risk score pill ─────────────────────────────────────────────────────────
function RiskPill({ claim }: { claim: FlaggedClaim }) {
  const isConfirmed = claim.label_is_fraud === 1;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: isConfirmed ? "#7f1d1d22" : "#78350f22",
      border: `1px solid ${isConfirmed ? "#ef444440" : "#f59e0b40"}`,
      color: isConfirmed ? "#fca5a5" : "#fcd34d",
      borderRadius: 8, padding: "3px 10px", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.04em", whiteSpace: "nowrap",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: isConfirmed ? "#ef4444" : "#f59e0b",
        boxShadow: `0 0 6px ${isConfirmed ? "#ef4444" : "#f59e0b"}`,
        flexShrink: 0,
      }} />
      {isConfirmed ? "CONFIRMED" : "POTENTIAL"}
    </span>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function ChartTip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1a1a30", border: "1px solid #2d2d4e",
      borderRadius: 10, padding: "10px 14px", fontSize: 12,
    }}>
      {label && <p style={{ color: "#6b7280", margin: "0 0 6px", fontSize: 11 }}>{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color ?? "#f1f5f9", margin: 0, fontWeight: 600 }}>
          {formatter ? formatter(p.value, p.name) : `${p.name}: ${p.value}`}
        </p>
      ))}
    </div>
  );
}

// ─── Sortable column header ───────────────────────────────────────────────────
function ColHeader({
  label, field, sort, dir, onSort,
}: {
  label: string; field: SortField;
  sort: SortField; dir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = sort === field;
  return (
    <button onClick={() => onSort(field)} style={{
      background: "none", border: "none", cursor: "pointer", padding: 0,
      color: active ? "#f1f5f9" : "#374151",
      fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
      display: "flex", alignItems: "center", gap: 4, transition: "color 0.15s",
    }}>
      {label}
      <span style={{ color: active ? "#38bdf8" : "#374151", fontSize: 10 }}>
        {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function HomePage() {
  const router = useRouter();
  const [claims, setClaims]         = useState<FlaggedClaim[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [filter, setFilter]         = useState<FilterType>("all");
  const [claimType, setClaimType]   = useState<ClaimTypeFilter>("all");
  const [sortField, setSortField]   = useState<SortField>("amount");
  const [sortDir, setSortDir]       = useState<SortDir>("desc");
  const [mounted, setMounted]       = useState(false);
  const [activeSection, setActiveSection] = useState<"claims" | "patterns">("claims");

  const user = getUser();

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    apiGet<FlaggedClaim[]>("/claims")
      .then(setClaims)
      .catch((e: any) => setError(e?.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  }, [sortField]);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const confirmed    = claims.filter(c => c.label_is_fraud === 1);
  const potential    = claims.filter(c => c.label_is_fraud !== 1);
  const totalAmount  = claims.reduce((s, c) => s + (c.claim_amount ?? 0), 0);
  const confirmedAmt = confirmed.reduce((s, c) => s + (c.claim_amount ?? 0), 0);
  const confirmRate  = claims.length ? Math.round(confirmed.length / claims.length * 100) : 0;

  const typeCounts = ["AUTO", "HOME", "HEALTH", "LIFE"].reduce(
    (acc, t) => ({ ...acc, [t]: claims.filter(c => c.claim_type === t).length }),
    {} as Record<string, number>
  );
  const typeChartData = Object.entries(typeCounts)
    .map(([name, value]) => ({ name, value, color: TYPE_META[name]?.color ?? "#6b7280" }))
    .filter(d => d.value > 0);

  const scenarioData = Object.entries(
    claims.reduce((acc, c) => {
      const s = c.fraud_scenario?.replace(/_/g, " ") ?? "unknown";
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));

  // Fake daily trend (last 7 days from filed_date distribution)
  const trendData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const label = d.toLocaleDateString("en-US", { weekday: "short" });
    const dayStr = d.toISOString().slice(0, 10);
    const dayClaims = claims.filter(c => (c.filed_date ?? "").startsWith(dayStr));
    return {
      label,
      confirmed: dayClaims.filter(c => c.label_is_fraud === 1).length,
      potential: dayClaims.filter(c => c.label_is_fraud !== 1).length,
    };
  });

  // ── Filtered + sorted list ─────────────────────────────────────────────────
  const filtered = claims
    .filter(c => filter === "confirmed" ? c.label_is_fraud === 1
               : filter === "potential" ? c.label_is_fraud !== 1 : true)
    .filter(c => claimType === "all" || c.claim_type === claimType)
    .filter(c =>
      !search.trim() ||
      c.claim_id.toLowerCase().includes(search.toLowerCase()) ||
      (c.policyholder_id ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.fraud_scenario ?? "").toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      let va: number, vb: number;
      if (sortField === "amount") { va = a.claim_amount ?? 0; vb = b.claim_amount ?? 0; }
      else if (sortField === "days") { va = a.days_to_file ?? 9999; vb = b.days_to_file ?? 9999; }
      else { va = 0; vb = 0; } // claim_id — string sort
      if (sortField === "claim_id")
        return sortDir === "asc"
          ? a.claim_id.localeCompare(b.claim_id)
          : b.claim_id.localeCompare(a.claim_id);
      return sortDir === "asc" ? va - vb : vb - va;
    });

  if (!mounted) return null;

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{
      display: "flex", minHeight: "100vh",
      background: "#09091a",
      fontFamily: "'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', monospace",
      color: "#e2e8f0",
    }}>
      {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
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
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em" }}>
                FraudGuard
              </p>
              <p style={{ margin: 0, fontSize: 10, color: "#3b82f6", fontWeight: 600, letterSpacing: "0.06em" }}>
                AI PLATFORM
              </p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
          {[
            { icon: "◈", label: "Overview",  section: "claims"   as const },
            { icon: "◉", label: "Patterns",  section: "patterns" as const },
          ].map(({ icon, label, section }) => (
            <button key={section} onClick={() => setActiveSection(section)} style={{
              background: activeSection === section ? "#1e3a5f" : "transparent",
              border: activeSection === section ? "1px solid #2563eb44" : "1px solid transparent",
              borderRadius: 9, padding: "9px 12px",
              color: activeSection === section ? "#60a5fa" : "#4b5563",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 9, textAlign: "left",
              transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 16 }}>{icon}</span> {label}
            </button>
          ))}

          <div style={{ margin: "8px 0", borderTop: "1px solid #1a1a30" }} />

          <button onClick={() => router.push("/cases")} style={{
            background: "transparent", border: "1px solid transparent",
            borderRadius: 9, padding: "9px 12px",
            color: "#4b5563", fontSize: 13, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 9, textAlign: "left",
            transition: "all 0.15s",
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#4b5563"; }}
          >
            <span style={{ fontSize: 16 }}>🗂</span> Cases
          </button>
        </nav>

        {/* User block */}
        {user && (
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
              transition: "all 0.15s",
            }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#ef444433";
                (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#1a1a30";
                (e.currentTarget as HTMLButtonElement).style.color = "#4b5563";
              }}
            >Sign Out</button>
          </div>
        )}
      </aside>

      {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
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
            <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>
              {activeSection === "claims" ? "Claims Overview" : "Pattern Analysis"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "#0d2c1a", border: "1px solid #166534",
              borderRadius: 8, padding: "4px 12px",
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%", background: "#22c55e",
                display: "inline-block", boxShadow: "0 0 8px #22c55e",
              }} />
              <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}>LIVE</span>
            </div>
            <span style={{ color: "#374151", fontSize: 11 }}>
              {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>
        </header>

        <div style={{ padding: "28px 28px 80px" }}>

          {activeSection === "claims" && (
            <>
              {/* ── PAGE TITLE ─────────────────────────────────────── */}
              <div style={{ marginBottom: 24 }}>
                <p style={{ color: "#3b82f6", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 4px" }}>
                  Fraud Detection · Insurance Claims
                </p>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: "#f1f5f9", letterSpacing: "-0.025em" }}>
                  Claims Intelligence
                </h1>
              </div>

              {/* ── KPI CARDS ──────────────────────────────────────── */}
              {loading ? (
                <div style={{ display: "flex", gap: 14, marginBottom: 24 }}>
                  {[...Array(4)].map((_, i) => (
                    <div key={i} style={{
                      flex: 1, height: 110, borderRadius: 16,
                      background: "linear-gradient(90deg, #141428 25%, #1a1a30 50%, #141428 75%)",
                      backgroundSize: "200% 100%",
                      animation: "shimmer 1.4s infinite",
                    }} />
                  ))}
                  <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
                  <KpiCard label="Flagged Claims"   value={claims.length}    color="#38bdf8" icon="🚨" sub="All flagged"               pct={100} />
                  <KpiCard label="Confirmed Fraud"  value={confirmed.length} color="#f87171" icon="🔴" sub={`${confirmRate}% confirm rate`} pct={confirmRate} trend="up" />
                  <KpiCard label="Under Review"     value={potential.length} color="#fbbf24" icon="⚠️" sub="Pending investigation"     pct={Math.round(potential.length / (claims.length || 1) * 100)} trend="neutral" />
                  <KpiCard label="Total Exposure"   value={fmtM(totalAmount)} color="#a78bfa" icon="💰" sub={`Confirmed: ${fmtM(confirmedAmt)}`} pct={Math.round(confirmedAmt / (totalAmount || 1) * 100)} trend="up" />
                </div>
              )}

              {/* ── CHARTS ROW ─────────────────────────────────────── */}
              {!loading && claims.length > 0 && (
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr 260px",
                  gap: 14, marginBottom: 24,
                }}>
                  {/* Trend area chart */}
                  <div style={{
                    background: "linear-gradient(145deg, #0d0d20 0%, #0a0a1a 100%)",
                    border: "1px solid #1a1a30", borderRadius: 16, padding: "20px 20px 12px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                      <div>
                        <p style={{ color: "#4b5563", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 2px" }}>
                          7-Day Activity
                        </p>
                        <p style={{ color: "#f1f5f9", fontSize: 15, fontWeight: 700, margin: 0 }}>Claim Trend</p>
                      </div>
                      <div style={{ display: "flex", gap: 12 }}>
                        {[["#f87171", "Confirmed"], ["#fbbf24", "Potential"]].map(([c, l]) => (
                          <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0 }} />
                            <span style={{ color: "#4b5563", fontSize: 10 }}>{l}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={150}>
                      <AreaChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gradConf" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"   stopColor="#f87171" stopOpacity={0.3} />
                            <stop offset="95%"  stopColor="#f87171" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradPot" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"   stopColor="#fbbf24" stopOpacity={0.25} />
                            <stop offset="95%"  stopColor="#fbbf24" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="label" tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#374151", fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<ChartTip />} />
                        <Area type="monotone" dataKey="confirmed" stroke="#f87171" strokeWidth={2} fill="url(#gradConf)" dot={false} />
                        <Area type="monotone" dataKey="potential" stroke="#fbbf24" strokeWidth={2} fill="url(#gradPot)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Scenario bar chart */}
                  <div style={{
                    background: "linear-gradient(145deg, #0d0d20 0%, #0a0a1a 100%)",
                    border: "1px solid #1a1a30", borderRadius: 16, padding: "20px 20px 12px",
                  }}>
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ color: "#4b5563", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 2px" }}>
                        By Scenario
                      </p>
                      <p style={{ color: "#f1f5f9", fontSize: 15, fontWeight: 700, margin: 0 }}>Fraud Patterns</p>
                    </div>
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={scenarioData} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                        <XAxis type="number" tick={{ fill: "#374151", fontSize: 9 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fill: "#6b7280", fontSize: 9 }} axisLine={false} tickLine={false} width={120} />
                        <Tooltip content={<ChartTip formatter={(v: number) => `${v} claims`} />} cursor={{ fill: "#ffffff05" }} />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={12}>
                          {scenarioData.map((_, i) => (
                            <Cell key={i} fill={SCENARIO_COLORS[i % SCENARIO_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Donut — type breakdown */}
                  <div style={{
                    background: "linear-gradient(145deg, #0d0d20 0%, #0a0a1a 100%)",
                    border: "1px solid #1a1a30", borderRadius: 16, padding: "20px",
                  }}>
                    <p style={{ color: "#4b5563", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 2px" }}>
                      Distribution
                    </p>
                    <p style={{ color: "#f1f5f9", fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>By Type</p>
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <ResponsiveContainer width={130} height={130}>
                        <PieChart>
                          <Pie data={typeChartData} dataKey="value" cx="50%" cy="50%"
                            innerRadius={38} outerRadius={58} paddingAngle={4}>
                            {typeChartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                          </Pie>
                          <Tooltip content={<ChartTip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                      {typeChartData.map(d => (
                        <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                          <span style={{ color: "#6b7280", fontSize: 11, flex: 1 }}>{TYPE_META[d.name]?.icon} {d.name}</span>
                          <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700 }}>{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── FILTER TOOLBAR ─────────────────────────────────── */}
              <div style={{
                background: "#0c0c1e", border: "1px solid #1a1a30",
                borderRadius: 14, padding: "14px 16px", marginBottom: 12,
                display: "flex", flexDirection: "column", gap: 10,
              }}>
                {/* Row 1 */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  {/* Search */}
                  <div style={{ flex: 1, minWidth: 240, position: "relative" }}>
                    <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#374151", fontSize: 13, pointerEvents: "none" }}>⌕</span>
                    <input
                      value={search} onChange={e => setSearch(e.target.value)}
                      placeholder="Search by claim ID, policyholder, scenario..."
                      style={{
                        width: "100%", padding: "8px 12px 8px 32px",
                        background: "#09091a", border: "1px solid #1a1a30",
                        borderRadius: 9, color: "#cbd5e1", fontSize: 12, outline: "none",
                        boxSizing: "border-box", transition: "border-color 0.15s",
                        fontFamily: "inherit",
                      }}
                      onFocus={e => (e.currentTarget.style.borderColor = "#3b82f6")}
                      onBlur={e => (e.currentTarget.style.borderColor = "#1a1a30")}
                    />
                  </div>

                  {/* Fraud filter segmented control */}
                  <div style={{ display: "flex", background: "#09091a", borderRadius: 10, padding: 3, border: "1px solid #1a1a30", gap: 2 }}>
                    {([["all", "All"], ["confirmed", "🔴 Confirmed"], ["potential", "🟡 Potential"]] as [FilterType, string][]).map(([f, l]) => (
                      <button key={f} onClick={() => setFilter(f)} style={{
                        padding: "6px 14px", borderRadius: 7, fontSize: 12, cursor: "pointer",
                        fontWeight: 600, border: "none", fontFamily: "inherit",
                        background: filter === f ? (f === "confirmed" ? "#7f1d1d" : f === "potential" ? "#78350f" : "#1e3a5f") : "transparent",
                        color: filter === f ? (f === "confirmed" ? "#fca5a5" : f === "potential" ? "#fcd34d" : "#60a5fa") : "#374151",
                        transition: "all 0.15s",
                      }}>{l}</button>
                    ))}
                  </div>
                </div>

                {/* Row 2 — type pills */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["all", "AUTO", "HOME", "HEALTH", "LIFE"] as ClaimTypeFilter[]).map(t => {
                    const active = claimType === t;
                    const meta   = t === "all" ? { color: "#6b7280", icon: "📋", label: "All Types" } : TYPE_META[t];
                    const count  = t === "all" ? claims.length : (typeCounts[t] ?? 0);
                    return (
                      <button key={t} onClick={() => setClaimType(t)} style={{
                        padding: "5px 12px", borderRadius: 8, fontSize: 11,
                        cursor: "pointer", fontWeight: 600, fontFamily: "inherit",
                        display: "flex", alignItems: "center", gap: 5,
                        background: active ? meta.color + "18" : "transparent",
                        border: `1px solid ${active ? meta.color + "55" : "#1a1a30"}`,
                        color: active ? meta.color : "#374151",
                        transition: "all 0.15s",
                      }}>
                        <span>{meta.icon}</span>
                        <span>{meta.label}</span>
                        <span style={{
                          background: active ? meta.color + "25" : "#141428",
                          color: active ? meta.color : "#374151",
                          borderRadius: 4, padding: "0 5px", fontSize: 10, fontWeight: 700,
                        }}>{count}</span>
                      </button>
                    );
                  })}
                  <div style={{ flex: 1 }} />
                  <span style={{ color: "#374151", fontSize: 11, alignSelf: "center" }}>
                    {filtered.length} of {claims.length} claims
                  </span>
                </div>
              </div>

              {/* ── CLAIMS TABLE ─────────────────────────────────────── */}
              {error && <p style={{ color: "#f87171", fontSize: 13 }}>Error: {error}</p>}

              {!loading && !error && (
                <div style={{
                  background: "#0c0c1e", border: "1px solid #1a1a30",
                  borderRadius: 14, overflow: "hidden",
                }}>
                  {/* Header */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "44px 2.2fr 1.1fr 1.2fr 2fr 1fr 1.1fr",
                    padding: "11px 18px",
                    background: "#09091a",
                    borderBottom: "1px solid #1a1a30",
                    gap: 8, alignItems: "center",
                  }}>
                    <span />
                    <ColHeader label="Claim ID"   field="claim_id" sort={sortField} dir={sortDir} onSort={handleSort} />
                    <ColHeader label="Amount"     field="amount"   sort={sortField} dir={sortDir} onSort={handleSort} />
                    <span style={{ color: "#374151", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Status</span>
                    <span style={{ color: "#374151", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Scenario</span>
                    <ColHeader label="Filed"      field="days"     sort={sortField} dir={sortDir} onSort={handleSort} />
                    <span style={{ color: "#374151", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", textAlign: "right" as const }}>Risk</span>
                  </div>

                  {filtered.length === 0 && (
                    <div style={{ padding: "48px", textAlign: "center", color: "#374151" }}>
                      <p style={{ fontSize: 32, margin: "0 0 10px" }}>◌</p>
                      <p style={{ fontSize: 13, margin: 0 }}>No claims match your filters.</p>
                    </div>
                  )}

                  {filtered.map((claim, idx) => {
                    const typeM   = TYPE_META[claim.claim_type ?? ""] ?? { color: "#4b5563", icon: "?", label: claim.claim_type ?? "?" };
                    const statusM = STATUS_META[claim.status ?? ""] ?? { color: "#4b5563", bg: "#4b556310" };
                    const isFast  = (claim.days_to_file ?? 999) <= 3;
                    const isConf  = claim.label_is_fraud === 1;
                    return (
                      <div
                        key={claim.claim_id}
                        onClick={() => router.push(`/claim/${encodeURIComponent(claim.claim_id)}`)}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "44px 2.2fr 1.1fr 1.2fr 2fr 1fr 1.1fr",
                          padding: "12px 18px",
                          cursor: "pointer", gap: 8, alignItems: "center",
                          borderBottom: idx < filtered.length - 1 ? "1px solid #0f0f1e" : "none",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "#12122a"}
                        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
                      >
                        {/* Risk color bar */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <div style={{
                            width: 4, height: 36, borderRadius: 2,
                            background: isConf ? "#ef4444" : "#f59e0b",
                            boxShadow: `0 0 8px ${isConf ? "#ef444466" : "#f59e0b66"}`,
                          }} />
                        </div>

                        {/* Claim ID + type */}
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, color: "#e2e8f0", fontSize: 13, fontWeight: 700, letterSpacing: "0.02em" }}>
                            {claim.claim_id}
                          </p>
                          <span style={{
                            background: typeM.color + "18", color: typeM.color,
                            borderRadius: 4, padding: "1px 7px", fontSize: 10, fontWeight: 700,
                            display: "inline-flex", alignItems: "center", gap: 3, marginTop: 2,
                          }}>
                            {typeM.icon} {claim.claim_type ?? "?"}
                          </span>
                        </div>

                        {/* Amount */}
                        <div>
                          <p style={{ margin: 0, color: "#f1f5f9", fontSize: 13, fontWeight: 700 }}>{fmt(claim.claim_amount)}</p>
                        </div>

                        {/* Status */}
                        <div>
                          <span style={{
                            background: statusM.bg, color: statusM.color,
                            border: `1px solid ${statusM.color}22`,
                            borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}>{claim.status ?? "—"}</span>
                        </div>

                        {/* Scenario */}
                        <div style={{ minWidth: 0 }}>
                          <p style={{
                            margin: 0, color: "#6b7280", fontSize: 12,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {claim.fraud_scenario?.replace(/_/g, " ") ?? <span style={{ color: "#374151" }}>—</span>}
                          </p>
                          {claim.policyholder_id && (
                            <p style={{ margin: "2px 0 0", color: "#374151", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {claim.policyholder_id}
                            </p>
                          )}
                        </div>

                        {/* Days to file */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <p style={{
                            margin: 0, fontSize: 12, fontWeight: isFast ? 700 : 400,
                            color: isFast ? "#f87171" : "#4b5563",
                          }}>
                            {isFast && "⚡ "}{claim.days_to_file ?? "?"}d
                          </p>
                          <p style={{ margin: 0, color: "#374151", fontSize: 10 }}>
                            {relativeDate(claim.filed_date)}
                          </p>
                        </div>

                        {/* Risk badge */}
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <RiskPill claim={claim} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeSection === "patterns" && <PatternsPanel />}
        </div>
      </main>

      <ChatWidget />
    </div>
  );
}
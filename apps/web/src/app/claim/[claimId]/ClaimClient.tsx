"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getUser, logout } from "@/lib/auth";
import RiskScore from "./RiskScore";
import InvestigatorBriefing from "./InvestigatorBriefing";
import GraphView from "./GraphView";
import MLScore from "./MLScore";
import CasePanel from "./CasePanel";
import DocumentPanel from "./DocumentPanel";
import ClaimChatWidget from "./ClaimChatWidget";

type ClaimResponse = { claim: Record<string, any>; links: Record<string, string | null> };
type RiskScoreData = { score: number; risk_level: string };

const STATUS_META: Record<string, { color: string; bg: string }> = {
  APPROVED:     { color: "#34d399", bg: "#34d39910" },
  DENIED:       { color: "#f87171", bg: "#f8717110" },
  PENDING:      { color: "#fbbf24", bg: "#fbbf2410" },
  UNDER_REVIEW: { color: "#38bdf8", bg: "#38bdf810" },
};
const TYPE_META: Record<string, { color: string; icon: string }> = {
  AUTO:   { color: "#38bdf8", icon: "🚗" },
  HOME:   { color: "#34d399", icon: "🏠" },
  HEALTH: { color: "#a78bfa", icon: "🏥" },
  LIFE:   { color: "#fbbf24", icon: "💛" },
};

const SKIP_FIELDS = new Set(["claim_id","claim_type","claim_amount","status","days_to_file","fraud_scenario","label_is_fraud"]);

function fmt(n: number | null) {
  if (n == null) return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function KpiCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub?: string; color: string; icon: string;
}) {
  return (
    <div style={{
      background: "linear-gradient(145deg, #141428 0%, #0e0e20 100%)",
      border: `1px solid ${color}22`, borderRadius: 14,
      padding: "18px 20px", flex: 1, minWidth: 150,
      position: "relative", overflow: "hidden",
      transition: "border-color 0.2s, transform 0.15s",
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = color + "55"; (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = color + "22"; (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)"; }}
    >
      <div style={{ position: "absolute", top: -16, right: -16, width: 64, height: 64, background: color, borderRadius: "50%", filter: "blur(32px)", opacity: 0.1, pointerEvents: "none" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <span style={{ color: "#4b5563", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{icon}</span>
      </div>
      <p style={{ color, fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ color: "#4b5563", fontSize: 11, margin: "5px 0 0" }}>{sub}</p>}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color}66, ${color}11)`, borderRadius: "0 0 14px 14px" }} />
    </div>
  );
}

function EntityChip({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ background: "#09091a", border: "1px solid #1a1a30", borderRadius: 9, padding: "10px 14px" }}>
      <p style={{ color: "#374151", fontSize: 10, fontWeight: 700, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
      <p style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, margin: "4px 0 0" }}>{value}</p>
    </div>
  );
}

export default function ClaimClient({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [data, setData]           = useState<ClaimResponse | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [riskScore, setRiskScore] = useState<RiskScoreData | null>(null);
  const [mounted, setMounted]     = useState(false);
  const user = getUser();

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    apiGet<ClaimResponse>(`/claims/${encodeURIComponent(claimId)}`).then(setData).catch((e: any) => setError(e?.message ?? "Failed to load claim"));
    apiGet<RiskScoreData>(`/scoring/claim/${encodeURIComponent(claimId)}`).then(setRiskScore).catch(() => {});
  }, [claimId]);

  if (error) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#09091a", color: "#f87171", fontFamily: "monospace" }}>
      Error: {error}
    </div>
  );
  if (!data) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#09091a", color: "#374151", fontFamily: "monospace" }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 32, margin: "0 0 10px" }}>⟳</p>
        <p style={{ fontSize: 13 }}>Loading claim...</p>
      </div>
    </div>
  );

  const { claim, links } = data;
  const isConfirmed  = claim.label_is_fraud === 1;
  const isPotential  = !isConfirmed && !!claim.fraud_scenario;
  const fraudColor   = isConfirmed ? "#f87171" : isPotential ? "#fbbf24" : "#34d399";
  const fraudLabel   = isConfirmed ? "Confirmed Fraud" : isPotential ? "Potential Fraud" : "No Flag";
  const typeM        = TYPE_META[claim.claim_type] ?? { color: "#6b7280", icon: "?" };
  const statusM      = STATUS_META[claim.status]   ?? { color: "#6b7280", bg: "#6b728010" };
  const isFast       = (claim.days_to_file ?? 999) <= 3;
  const remainingFields = Object.entries(claim).filter(([k]) => !SKIP_FIELDS.has(k));

  return (
    <div style={{
      display: "flex", minHeight: "100vh", background: "#09091a",
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

        <nav style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
          {[
            { icon: "◈", label: "Overview", path: "/" },
            { icon: "◉", label: "Patterns",  path: "/" },
            { icon: "🗂", label: "Cases",     path: "/cases" },
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
              <span style={{ fontSize: 15 }}>{icon}</span> {label}
            </button>
          ))}
        </nav>

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
                <p style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 600, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.username}</p>
                <p style={{ color: "#1d4ed8", fontSize: 10, margin: 0, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{user.role}</p>
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

        {/* Sticky header */}
        <header style={{
          borderBottom: "1px solid #1a1a30", padding: "0 28px",
          height: 56, display: "flex", alignItems: "center",
          justifyContent: "space-between", background: "#09091acc",
          backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 50,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => router.push("/")} style={{
              background: "none", border: "1px solid #1a1a30", borderRadius: 7,
              padding: "5px 12px", color: "#4b5563", fontSize: 12, cursor: "pointer",
              fontFamily: "inherit", transition: "all 0.15s",
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#3b82f6"; (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#1a1a30"; (e.currentTarget as HTMLButtonElement).style.color = "#4b5563"; }}
            >← Back</button>
            <span style={{ color: "#4b5563", fontSize: 12 }}>Claims /</span>
            <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>{claimId}</span>
            {/* Fraud badge in header */}
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: fraudColor + "18", border: `1px solid ${fraudColor}33`,
              color: fraudColor, borderRadius: 7,
              padding: "3px 10px", fontSize: 11, fontWeight: 700,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: fraudColor, boxShadow: `0 0 6px ${fraudColor}`, flexShrink: 0 }} />
              {fraudLabel}
            </span>
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
          <div style={{ marginBottom: 22 }}>
            <p style={{ color: "#3b82f6", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 4px" }}>
              Claim Detail · {claim.claim_type ?? "Unknown Type"}
            </p>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: "#f1f5f9", letterSpacing: "-0.025em" }}>
              {claimId}
            </h1>
          </div>

          {/* KPI cards */}
          <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
            <KpiCard
              label="Claim Amount" icon="💰" color="#38bdf8"
              value={fmt(claim.claim_amount)}
            />
            <KpiCard
              label="Claim Type" icon={typeM.icon} color={typeM.color}
              value={claim.claim_type ?? "—"}
            />
            <KpiCard
              label="Status" icon="📋" color={statusM.color}
              value={claim.status ?? "—"}
            />
            <KpiCard
              label="Days to File" icon={isFast ? "⚡" : "📅"} color={isFast ? "#f87171" : "#6b7280"}
              value={claim.days_to_file != null ? `${claim.days_to_file}d` : "—"}
              sub={isFast ? "Suspiciously fast" : undefined}
            />
            <KpiCard
              label="Fraud Scenario" icon="🎯" color={claim.fraud_scenario ? "#fbbf24" : "#374151"}
              value={claim.fraud_scenario ? claim.fraud_scenario.replace(/_/g, " ") : "None"}
            />
          </div>

          {/* Sections — same card style throughout */}
          {[
            <RiskScore key="risk" claimId={claimId} />,
            <MLScore key="ml" claimId={claimId} ruleBasedScore={riskScore?.score ?? 0} ruleBasedLevel={riskScore?.risk_level ?? "LOW"} />,
            <CasePanel key="case" claimId={claimId} priority={riskScore?.risk_level ?? "MEDIUM"} />,
            <InvestigatorBriefing key="briefing" claimId={claimId} />,
          ].map((el, i) => (
            <div key={i} style={{ marginBottom: 16 }}>{el}</div>
          ))}

          {/* Details + Entities */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
            <div style={{
              background: "#0c0c1e", border: "1px solid #1a1a30",
              borderRadius: 14, padding: "20px 22px",
            }}>
              <p style={{ color: "#374151", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 14px" }}>
                Claim Details
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {remainingFields.map(([key, val]) => (
                    <tr key={key} style={{ borderTop: "1px solid #0f0f1e" }}>
                      <td style={{ padding: "8px 4px 8px 0", color: "#4b5563", fontWeight: 600, width: "42%", verticalAlign: "top" }}>
                        {key.replace(/_/g, " ")}
                      </td>
                      <td style={{ padding: "8px 4px", color: "#94a3b8", wordBreak: "break-all", verticalAlign: "top" }}>
                        {val === null || val === undefined ? <span style={{ color: "#374151" }}>—</span> : String(val)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{
              background: "#0c0c1e", border: "1px solid #1a1a30",
              borderRadius: 14, padding: "20px 22px",
            }}>
              <p style={{ color: "#374151", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 14px" }}>
                Linked Entities
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <EntityChip label="Policyholder" value={links.policyholder_id} />
                <EntityChip label="Bank Account" value={links.bank_account_id} />
                <EntityChip label="Adjuster"     value={links.adjuster_id} />
                <EntityChip label="Provider"     value={links.provider_id} />
                <EntityChip label="Vehicle"      value={links.vehicle_id} />
              </div>
            </div>
          </div>

          {/* Graph */}
          <div style={{
            background: "#0c0c1e", border: "1px solid #1a1a30",
            borderRadius: 14, padding: "20px 22px", marginBottom: 16,
          }}>
            <p style={{ color: "#374151", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 14px" }}>
              Graph Neighborhood
            </p>
            <GraphView claimId={claimId} />
          </div>

          <DocumentPanel claimId={claimId} />

        </div>
      </main>

      <ClaimChatWidget context={{
        claimId,
        claimAmount:   claim.claim_amount,
        claimType:     claim.claim_type,
        status:        claim.status,
        fraudScenario: claim.fraud_scenario,
        labelIsFraud:  claim.label_is_fraud,
      }} />
    </div>
  );
}
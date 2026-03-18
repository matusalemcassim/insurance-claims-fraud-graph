"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

type Signal = {
  signal:   string;
  points:   number;
  severity: "high" | "medium" | "low";
};
type RiskScoreData = {
  claim_id:             string;
  score:                number;
  raw_score:            number;
  risk_level:           "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  signals:              Signal[];
  bank_account_id:      string | null;
  bank_claim_count:     number;
  adjuster_id:          string | null;
  adjuster_claim_count: number;
};

const RISK_META: Record<string, { color: string }> = {
  CRITICAL: { color: "#f87171" },
  HIGH:     { color: "#fb923c" },
  MEDIUM:   { color: "#fbbf24" },
  LOW:      { color: "#34d399" },
};
const SEV_COLOR: Record<string, string> = {
  high:   "#f87171",
  medium: "#fbbf24",
  low:    "#34d399",
};

export default function RiskScore({ claimId }: { claimId: string }) {
  const [data, setData]       = useState<RiskScoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [open, setOpen]       = useState(true);

  useEffect(() => {
    apiGet<RiskScoreData>(`/scoring/claim/${encodeURIComponent(claimId)}`)
      .then(setData)
      .catch((e: any) => setError(e?.message ?? "Failed to load risk score"))
      .finally(() => setLoading(false));
  }, [claimId]);

  const color = data ? (RISK_META[data.risk_level]?.color ?? "#6b7280") : "#6b7280";
  const circumference = 2 * Math.PI * 40;
  const dashOffset = data ? circumference - (data.score / 100) * circumference : circumference;

  return (
    <div style={{
      background: "#0c0c1e",
      border: `1px solid ${data ? color + "33" : "#1a1a30"}`,
      borderRadius: 14, overflow: "hidden",
      fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
      transition: "border-color 0.3s",
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "16px 22px", cursor: "pointer",
          borderBottom: open ? "1px solid #1a1a30" : "none",
          transition: "background 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "#12122a"}
        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>🎯</span>
          <p style={{ color: "#f1f5f9", fontSize: 14, fontWeight: 700, margin: 0 }}>
            Fraud Risk Score
          </p>
          {data && !loading && (
            <span style={{
              background: color + "18", border: `1px solid ${color}33`,
              color, borderRadius: 6, padding: "2px 10px",
              fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
            }}>
              {data.risk_level} · {data.score}/100
            </span>
          )}
          {loading && <span style={{ color: "#374151", fontSize: 11 }}>Computing...</span>}
        </div>
        <span style={{ color: "#374151", fontSize: 11 }}>{open ? "▲ collapse" : "▼ expand"}</span>
      </div>

      {/* Body */}
      {open && (
        <div style={{ padding: "22px 22px" }}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid #3b82f6", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
              <p style={{ color: "#4b5563", fontSize: 12, margin: 0 }}>Computing risk score...</p>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}
          {error && <p style={{ color: "#f87171", fontSize: 12, margin: 0 }}>Error: {error}</p>}

          {data && !loading && (
            <div style={{ display: "flex", gap: 32, alignItems: "flex-start", flexWrap: "wrap" }}>

              {/* Score gauge */}
              <div style={{ textAlign: "center", minWidth: 110 }}>
                <svg width={100} height={100} viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#1a1a30" strokeWidth="9" />
                  <circle cx="50" cy="50" r="40"
                    fill="none" stroke={color} strokeWidth="9"
                    strokeDasharray={circumference} strokeDashoffset={dashOffset}
                    strokeLinecap="round" transform="rotate(-90 50 50)"
                    style={{ transition: "stroke-dashoffset 0.8s ease", filter: `drop-shadow(0 0 6px ${color}66)` }}
                  />
                  <text x="50" y="47" textAnchor="middle" fill={color} fontSize="20" fontWeight="800">{data.score}</text>
                  <text x="50" y="62" textAnchor="middle" fill="#374151" fontSize="9">/ 100</text>
                </svg>
                <div style={{ marginTop: 6, fontWeight: 800, fontSize: 12, color, letterSpacing: "0.08em" }}>
                  {data.risk_level}
                </div>
              </div>

              {/* Signals */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <p style={{ color: "#374151", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>
                  Contributing Signals ({data.signals.length})
                </p>
                {data.signals.length === 0 && (
                  <p style={{ color: "#374151", fontSize: 12 }}>No risk signals detected.</p>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {data.signals.map((s, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      background: "#09091a", borderRadius: 7, padding: "7px 12px",
                      border: `1px solid ${SEV_COLOR[s.severity] ?? "#1a1a30"}18`,
                    }}>
                      <span style={{ color: "#94a3b8", fontSize: 12 }}>{s.signal}</span>
                      <span style={{
                        color: SEV_COLOR[s.severity] ?? "#6b7280",
                        fontWeight: 700, fontSize: 11, marginLeft: 12, whiteSpace: "nowrap",
                      }}>+{s.points} pts</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Context */}
              <div style={{ minWidth: 160 }}>
                <p style={{ color: "#374151", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>
                  Context
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {data.bank_account_id && (
                    <div style={{ background: "#09091a", border: "1px solid #1a1a30", borderRadius: 9, padding: "10px 14px" }}>
                      <p style={{ color: "#374151", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>Bank Account</p>
                      <p style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, margin: "4px 0 2px" }}>{data.bank_account_id}</p>
                      <p style={{ fontSize: 11, margin: 0, color: data.bank_claim_count >= 3 ? "#f87171" : "#4b5563" }}>
                        {data.bank_claim_count} claims use this account
                      </p>
                    </div>
                  )}
                  {data.adjuster_id && (
                    <div style={{ background: "#09091a", border: "1px solid #1a1a30", borderRadius: 9, padding: "10px 14px" }}>
                      <p style={{ color: "#374151", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>Adjuster</p>
                      <p style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, margin: "4px 0 2px" }}>{data.adjuster_id}</p>
                      <p style={{ fontSize: 11, margin: 0, color: data.adjuster_claim_count > 50 ? "#fbbf24" : "#4b5563" }}>
                        {data.adjuster_claim_count} claims handled
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
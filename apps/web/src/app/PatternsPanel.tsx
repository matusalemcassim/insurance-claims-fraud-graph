"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";

type Pattern = {
  pattern: string;
  pattern_label: string;
  severity: "high" | "medium";
  description: string;
  claim_ids: string[];
  claim_count: number;
  total_amount: number | null;
  // shared bank
  bank_account_id?: string;
  bank_name?: string;
  // adjuster overload
  adjuster_id?: string;
  fraud_count?: number;
  // rapid reclaim
  policyholder_id?: string;
  date_span_days?: number;
  earliest_claim?: string;
  latest_claim?: string;
  // shared rep
  rep_id?: string;
  rep_type?: string;
};

type PatternsResponse = {
  total_patterns: number;
  high_severity: number;
  medium_severity: number;
  patterns: {
    shared_bank_account_rings: Pattern[];
    adjuster_overload: Pattern[];
    rapid_reclaim_clusters: Pattern[];
    shared_representatives: Pattern[];
  };
};

function severityColor(severity: string) {
  return severity === "high" ? "#ef4444" : "#f59e0b";
}

function patternIcon(pattern: string) {
  switch (pattern) {
    case "shared_bank_account_ring":     return "🏦";
    case "adjuster_overload":            return "👤";
    case "rapid_reclaim_cluster":        return "⚡";
    case "shared_representative":        return "⚖️";
    default:                             return "⚠️";
  }
}

function PatternCard({ p, onClaimClick }: { p: Pattern; onClaimClick: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const color = severityColor(p.severity);

  return (
    <div style={{
      border: `1px solid ${color}44`,
      borderRadius: 10, background: "#1a1a2e",
      overflow: "hidden", marginBottom: 10,
    }}>
      {/* Header row */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto auto",
          alignItems: "center",
          gap: 12, padding: "14px 18px",
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 20 }}>{patternIcon(p.pattern)}</span>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>
              {p.pattern_label}
            </span>
            <span style={{
              background: p.severity === "high" ? "#7f1d1d" : "#78350f",
              color, borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 700,
            }}>
              {p.severity.toUpperCase()}
            </span>
          </div>
          <p style={{ color: "#94a3b8", fontSize: 13, margin: "3px 0 0" }}>
            {p.description}
          </p>
        </div>

        <div style={{ textAlign: "right" }}>
          <p style={{ color: "#6b7280", fontSize: 11, margin: 0 }}>Claims</p>
          <p style={{ color, fontWeight: 700, fontSize: 18, margin: "2px 0 0" }}>
            {p.claim_count}
          </p>
        </div>

        <span style={{ color: "#6b7280", fontSize: 12 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded claim list */}
      {expanded && (
        <div style={{
          borderTop: `1px solid ${color}22`,
          padding: "12px 18px",
          background: "#0f0f1a",
        }}>
          {p.total_amount != null && (
            <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 10 }}>
              Total exposure:{" "}
              <span style={{ color: "#f1f5f9", fontWeight: 600 }}>
                ${p.total_amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
              </span>
            </p>
          )}

          {/* Extra metadata */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
            {p.bank_account_id && (
              <span style={{ color: "#94a3b8", fontSize: 12 }}>
                Account: <strong style={{ color: "#f97316" }}>{p.bank_account_id}</strong>
                {p.bank_name && ` (${p.bank_name})`}
              </span>
            )}
            {p.adjuster_id && (
              <span style={{ color: "#94a3b8", fontSize: 12 }}>
                Adjuster: <strong style={{ color: "#8b5cf6" }}>{p.adjuster_id}</strong>
                {p.fraud_count != null && p.fraud_count > 0 && (
                  <span style={{ color: "#ef4444", marginLeft: 6 }}>
                    {p.fraud_count} confirmed fraud
                  </span>
                )}
              </span>
            )}
            {p.policyholder_id && (
              <span style={{ color: "#94a3b8", fontSize: 12 }}>
                Policyholder: <strong style={{ color: "#10b981" }}>{p.policyholder_id}</strong>
              </span>
            )}
            {p.date_span_days != null && (
              <span style={{ color: "#94a3b8", fontSize: 12 }}>
                Span: <strong style={{ color: "#f59e0b" }}>{p.date_span_days} days</strong>
                {p.earliest_claim && ` (${p.earliest_claim} → ${p.latest_claim})`}
              </span>
            )}
          </div>

          {/* Claim ID chips */}
          <p style={{ color: "#6b7280", fontSize: 11, marginBottom: 6 }}>
            Click a claim to investigate:
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {p.claim_ids.map((id) => (
              <button
                key={id}
                onClick={() => onClaimClick(id)}
                style={{
                  background: "#1a1a2e", border: `1px solid ${color}66`,
                  borderRadius: 6, padding: "4px 10px",
                  color: "#f1f5f9", fontSize: 12, cursor: "pointer",
                  fontFamily: "monospace",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = color + "22")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#1a1a2e")}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PatternsPanel() {
  const router = useRouter();
  const [data, setData]       = useState<PatternsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [open, setOpen]       = useState(true);

  useEffect(() => {
    apiGet<PatternsResponse>("/patterns")
      .then(setData)
      .catch((e: any) => setError(e?.message ?? "Failed to load patterns"))
      .finally(() => setLoading(false));
  }, []);

  const allPatterns = data
    ? [
        ...data.patterns.shared_bank_account_rings,
        ...data.patterns.adjuster_overload,
        ...data.patterns.rapid_reclaim_clusters,
        ...data.patterns.shared_representatives,
      ].sort((a, b) => {
        if (a.severity === b.severity) return b.claim_count - a.claim_count;
        return a.severity === "high" ? -1 : 1;
      })
    : [];

  return (
    <div style={{
      marginTop: 32, border: "1px solid #2d2d4e",
      borderRadius: 12, background: "#0f0f1a", overflow: "hidden",
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "16px 20px",
          background: "none", border: "none", cursor: "pointer", color: "#f1f5f9",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>🔎 Fraud Pattern Detection</span>
          {data && (
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{
                background: "#7f1d1d", color: "#fca5a5",
                borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 700,
              }}>
                {data.high_severity} high
              </span>
              <span style={{
                background: "#78350f", color: "#fcd34d",
                borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 700,
              }}>
                {data.medium_severity} medium
              </span>
            </div>
          )}
        </div>
        <span style={{ color: "#6b7280", fontSize: 12 }}>{open ? "▲ collapse" : "▼ expand"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          {loading && <p style={{ color: "#94a3b8", padding: 12 }}>Running pattern detection...</p>}
          {error   && <p style={{ color: "#ef4444", padding: 12 }}>Error: {error}</p>}
          {!loading && !error && allPatterns.length === 0 && (
            <p style={{ color: "#6b7280", padding: 12 }}>No fraud patterns detected.</p>
          )}
          {allPatterns.map((p, i) => (
            <PatternCard
              key={i}
              p={p}
              onClaimClick={(id) => router.push(`/claim/${encodeURIComponent(id)}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
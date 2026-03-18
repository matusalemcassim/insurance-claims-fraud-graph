"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

type SummaryResponse = {
  claim_id:   string;
  risk_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  score:      number;
  briefing:   string;
};

const RISK_META: Record<string, { color: string }> = {
  CRITICAL: { color: "#f87171" },
  HIGH:     { color: "#fb923c" },
  MEDIUM:   { color: "#fbbf24" },
  LOW:      { color: "#34d399" },
};

export default function InvestigatorBriefing({ claimId }: { claimId: string }) {
  const [data, setData]         = useState<SummaryResponse | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [open, setOpen]         = useState(true);

  const generate = () => {
    setRequested(true);
    setLoading(true);
    setError(null);
    apiGet<SummaryResponse>(`/summary/claim/${encodeURIComponent(claimId)}`)
      .then(setData)
      .catch((e: any) => setError(e?.message ?? "Failed to generate briefing"))
      .finally(() => setLoading(false));
  };

  const color = data ? (RISK_META[data.risk_level]?.color ?? "#6b7280") : "#6b7280";

  return (
    <div style={{
      background: "#0c0c1e",
      border: `1px solid ${data ? color + "33" : "#1a1a30"}`,
      borderRadius: 14, overflow: "hidden",
      transition: "border-color 0.3s",
      fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
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
          <span style={{ fontSize: 16 }}>🤖</span>
          <p style={{ color: "#f1f5f9", fontSize: 14, fontWeight: 700, margin: 0 }}>
            Investigator Briefing
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
          {loading && (
            <span style={{ color: "#374151", fontSize: 11 }}>Analyzing...</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {requested && !loading && data && (
            <button onClick={e => { e.stopPropagation(); generate(); }} style={{
              background: "transparent", border: "1px solid #1a1a30",
              borderRadius: 7, padding: "4px 10px",
              color: "#4b5563", fontSize: 11, cursor: "pointer",
              fontFamily: "inherit", transition: "all 0.15s",
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#3b82f6"; (e.currentTarget as HTMLButtonElement).style.color = "#60a5fa"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#1a1a30"; (e.currentTarget as HTMLButtonElement).style.color = "#4b5563"; }}
            >↻ Regenerate</button>
          )}
          <span style={{ color: "#374151", fontSize: 11 }}>{open ? "▲ collapse" : "▼ expand"}</span>
        </div>
      </div>

      {/* Body */}
      {open && (
        <div style={{ padding: "20px 22px" }}>
          {!requested && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <p style={{ color: "#374151", fontSize: 12, margin: 0, lineHeight: 1.6 }}>
                Generate an AI-powered summary combining risk score, graph signals, and claim context.
              </p>
              <button onClick={generate} style={{
                background: "linear-gradient(135deg, #1d4ed8, #4f46e5)",
                border: "none", borderRadius: 9,
                padding: "9px 20px", color: "#fff", fontSize: 12,
                fontWeight: 700, cursor: "pointer", flexShrink: 0,
                fontFamily: "inherit", boxShadow: "0 4px 14px #3b82f630",
                transition: "opacity 0.15s",
              }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = "0.85"}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = "1"}
              >Generate Briefing</button>
            </div>
          )}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 16, height: 16, borderRadius: "50%",
                border: "2px solid #3b82f6", borderTopColor: "transparent",
                animation: "spin 0.8s linear infinite", flexShrink: 0,
              }} />
              <p style={{ color: "#4b5563", fontSize: 12, margin: 0 }}>
                Analyzing claim and generating briefing...
              </p>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}

          {error && (
            <p style={{ color: "#f87171", fontSize: 12, margin: 0 }}>Error: {error}</p>
          )}

          {data && !loading && (
            <div>
              <p style={{
                color: "#e2e8f0", fontSize: 13, lineHeight: 1.8,
                margin: 0, whiteSpace: "pre-wrap",
                borderLeft: `3px solid ${color}`,
                paddingLeft: 16,
              }}>
                {data.briefing}
              </p>
              <p style={{ color: "#374151", fontSize: 10, margin: "14px 0 0", letterSpacing: "0.04em" }}>
                Generated by Claude · Risk signals + graph context + claim properties
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
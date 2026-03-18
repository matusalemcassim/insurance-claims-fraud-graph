"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

type MLScoreData = {
  claim_id: string;
  ml_score: number;
  probability: number;
  risk_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  model: string;
  features_used: number;
};

type GNNScoreData = {
  claim_id: string;
  gnn_score: number;
  probability: number;
  risk_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  model: string;
  neighbors_used: number;
};

function riskColor(level: string): string {
  switch (level) {
    case "CRITICAL": return "#ef4444";
    case "HIGH":     return "#f97316";
    case "MEDIUM":   return "#f59e0b";
    case "LOW":      return "#10b981";
    default:         return "#6b7280";
  }
}

function Gauge({ score, color, label, sub }: {
  score: number; color: string; label: string; sub?: string;
}) {
  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div style={{ textAlign: "center", minWidth: 80 }}>
      <svg width={72} height={72} viewBox="0 0 72 72">
        <circle cx="36" cy="36" r="28" fill="none" stroke="#2d2d4e" strokeWidth="7" />
        <circle cx="36" cy="36" r="28" fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 36 36)"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
        <text x="36" y="32" textAnchor="middle" fill={color} fontSize="14" fontWeight="bold">
          {score}
        </text>
        <text x="36" y="44" textAnchor="middle" fill="#6b7280" fontSize="7">
          /100
        </text>
      </svg>
      <p style={{ color: "#94a3b8", fontSize: 11, margin: "4px 0 2px", fontWeight: 600 }}>{label}</p>
      {sub && <p style={{ color: "#6b7280", fontSize: 10, margin: 0 }}>{sub}</p>}
    </div>
  );
}

function EnsembleVerdict({ scores, levels }: { scores: number[]; levels: string[] }) {
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const allAgree = levels.every(l => l === levels[0]);
  const criticalCount = levels.filter(l => l === "CRITICAL" || l === "HIGH").length;

  let verdict = "";
  let color = "#10b981";
  let icon = "✓";

  if (allAgree) {
    verdict = `All models agree: ${levels[0]}`;
    color = riskColor(levels[0]);
    icon = levels[0] === "LOW" ? "✓" : "⚠";
  } else if (criticalCount >= 2) {
    verdict = "Majority signal: HIGH RISK";
    color = "#f97316";
    icon = "⚠";
  } else {
    verdict = "Models disagree — manual review recommended";
    color = "#f59e0b";
    icon = "?";
  }

  return (
    <div style={{
      background: color + "15", border: `1px solid ${color}44`,
      borderRadius: 8, padding: "10px 16px", marginBottom: 16,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ color, fontSize: 16 }}>{icon}</span>
      <div>
        <p style={{ color, fontSize: 13, fontWeight: 700, margin: 0 }}>{verdict}</p>
        <p style={{ color: "#6b7280", fontSize: 11, margin: "2px 0 0" }}>
          Ensemble average: {avg.toFixed(1)}/100
        </p>
      </div>
    </div>
  );
}

export default function MLScore({
  claimId,
  ruleBasedScore,
  ruleBasedLevel,
}: {
  claimId: string;
  ruleBasedScore: number;
  ruleBasedLevel: string;
}) {
  const [mlData, setMlData]   = useState<MLScoreData | null>(null);
  const [gnnData, setGnnData] = useState<GNNScoreData | null>(null);
  const [mlError, setMlError] = useState<string | null>(null);
  const [gnnError, setGnnError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const mlPromise = apiGet<MLScoreData>(`/ml/score/${encodeURIComponent(claimId)}`)
      .then(setMlData)
      .catch((e: any) => setMlError(e?.message ?? "Failed"));

    const gnnPromise = apiGet<GNNScoreData>(`/gnn/score/${encodeURIComponent(claimId)}`)
      .then(setGnnData)
      .catch((e: any) => setGnnError(e?.message ?? "Failed"));

    Promise.all([mlPromise, gnnPromise]).finally(() => setLoading(false));
  }, [claimId]);

  const ruleColor = riskColor(ruleBasedLevel);
  const mlColor   = mlData  ? riskColor(mlData.risk_level)  : "#6b7280";
  const gnnColor  = gnnData ? riskColor(gnnData.risk_level) : "#6b7280";

  const allLoaded = mlData && gnnData;
  const scores = allLoaded ? [ruleBasedScore, mlData.ml_score, gnnData.gnn_score] : [];
  const levels = allLoaded ? [ruleBasedLevel, mlData.risk_level, gnnData.risk_level] : [];

  return (
    <div style={{
      background: "#1a1a2e", border: "1px solid #2d2d4e",
      borderRadius: 12, padding: "20px 24px", marginBottom: 24,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
            🤖 Model Score Comparison
          </h2>
          <p style={{ color: "#6b7280", fontSize: 12, margin: "4px 0 0" }}>
            Rule-based · XGBoost · GraphSAGE GNN
          </p>
        </div>
      </div>

      {loading && <p style={{ color: "#94a3b8", fontSize: 13 }}>Loading model scores...</p>}

      {!loading && allLoaded && (
        <>
          <EnsembleVerdict scores={scores} levels={levels} />

          {/* Three gauges */}
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
              <Gauge score={ruleBasedScore} color={ruleColor} label="Rule-Based" sub="Hand-crafted" />
              <span style={{ color: "#2d2d4e", fontSize: 18, marginTop: -16 }}>|</span>
              <Gauge score={mlData.ml_score} color={mlColor} label="XGBoost" sub={`${mlData.features_used} features`} />
              <span style={{ color: "#2d2d4e", fontSize: 18, marginTop: -16 }}>|</span>
              <Gauge
                score={gnnData.gnn_score} color={gnnColor} label="GraphSAGE"
                sub={`${gnnData.neighbors_used} neighbors`}
              />
            </div>

            {/* Detail table */}
            <div style={{ flex: 1, minWidth: 220 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ color: "#4b5563", textAlign: "left", padding: "4px 8px 8px 0", fontWeight: 600 }}>Model</th>
                    <th style={{ color: "#4b5563", textAlign: "right", padding: "4px 0 8px", fontWeight: 600 }}>Score</th>
                    <th style={{ color: "#4b5563", textAlign: "right", padding: "4px 0 8px 8px", fontWeight: 600 }}>Probability</th>
                    <th style={{ color: "#4b5563", textAlign: "right", padding: "4px 0 8px", fontWeight: 600 }}>Level</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "Rule-Based", score: ruleBasedScore, prob: null, level: ruleBasedLevel, color: ruleColor },
                    { name: "XGBoost",    score: mlData.ml_score, prob: mlData.probability, level: mlData.risk_level, color: mlColor },
                    { name: "GraphSAGE",  score: gnnData.gnn_score, prob: gnnData.probability, level: gnnData.risk_level, color: gnnColor },
                  ].map((row) => (
                    <tr key={row.name} style={{ borderTop: "1px solid #2d2d4e" }}>
                      <td style={{ padding: "7px 8px 7px 0", color: "#94a3b8" }}>{row.name}</td>
                      <td style={{ padding: "7px 0", color: row.color, fontWeight: 700, textAlign: "right" }}>{row.score}</td>
                      <td style={{ padding: "7px 0 7px 8px", color: "#6b7280", textAlign: "right" }}>
                        {row.prob !== null ? `${(row.prob * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td style={{ padding: "7px 0 7px 8px", textAlign: "right" }}>
                        <span style={{
                          background: row.color + "22", color: row.color,
                          borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700,
                        }}>
                          {row.level}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Partial load — show what we have */}
      {!loading && !allLoaded && (
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <Gauge score={ruleBasedScore} color={ruleColor} label="Rule-Based" sub="Hand-crafted" />
          {mlData  && <Gauge score={mlData.ml_score}   color={mlColor}  label="XGBoost"    sub={`${mlData.features_used} features`} />}
          {gnnData && <Gauge score={gnnData.gnn_score} color={gnnColor} label="GraphSAGE"  sub={`${gnnData.neighbors_used} neighbors`} />}
          {mlError  && <p style={{ color: "#ef4444", fontSize: 12 }}>XGBoost: {mlError}</p>}
          {gnnError && <p style={{ color: "#ef4444", fontSize: 12 }}>GNN: {gnnError}</p>}
        </div>
      )}
    </div>
  );
}
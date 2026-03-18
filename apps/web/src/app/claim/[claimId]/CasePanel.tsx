"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { getUser } from "@/lib/auth";

type Case = {
  case_id:     string;
  claim_id:    string;
  status:      string;
  priority:    string;
  assigned_to: string;
  notes:       string;
  decision:    string;
  created_at:  string;
  updated_at:  string;
};

const STATUS_COLORS: Record<string, string> = {
  OPEN:            "#3b82f6",
  IN_REVIEW:       "#f59e0b",
  CONFIRMED_FRAUD: "#ef4444",
  DISMISSED:       "#10b981",
};

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH:     "#f97316",
  MEDIUM:   "#f59e0b",
  LOW:      "#10b981",
};

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      background: color + "22", color, borderRadius: 999,
      padding: "2px 10px", fontSize: 11, fontWeight: 700,
    }}>
      {label.replace("_", " ")}
    </span>
  );
}

export default function CasePanel({
  claimId,
  priority,
}: {
  claimId: string;
  priority: string;
}) {
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [notes, setNotes]       = useState("");
  const [decision, setDecision] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const user = getUser();

  useEffect(() => {
    apiGet<Case>(`/cases/claim/${encodeURIComponent(claimId)}`)
      .then((c) => {
        setCaseData(c);
        setNotes(c.notes || "");
        setDecision(c.decision || "");
      })
      .catch(() => setCaseData(null))
      .finally(() => setLoading(false));
  }, [claimId]);

  async function openCase() {
    setSaving(true);
    setError(null);
    try {
      const c = await apiPost<Case>("/cases", {
        claim_id:    claimId,
        assigned_to: user?.username ?? "investigator",
        priority:    priority || "MEDIUM",
      });
      setCaseData(c);
      setNotes(c.notes || "");
      setDecision(c.decision || "");
    } catch (e: any) {
      setError(e?.message ?? "Failed to open case");
    } finally {
      setSaving(false);
    }
  }

  async function saveNotes() {
    if (!caseData) return;
    setSaving(true);
    try {
      const updated = await apiPatch<Case>(`/cases/${caseData.case_id}`, { notes, decision });
      setCaseData(updated);
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: string) {
    if (!caseData) return;
    setSaving(true);
    try {
      const updated = await apiPatch<Case>(`/cases/${caseData.case_id}`, { status, notes, decision });
      setCaseData(updated);
    } finally {
      setSaving(false);
    }
  }

  const isClosed = caseData && ["CONFIRMED_FRAUD", "DISMISSED"].includes(caseData.status);
  const borderColor = caseData ? (STATUS_COLORS[caseData.status] ?? "#2d2d4e") : "#2d2d4e";

  return (
    <div style={{
      background: "#1a1a2e", border: `1px solid ${borderColor}`,
      borderRadius: 12, padding: "20px 24px", marginBottom: 24,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
            Investigation Case
          </h2>
          <p style={{ color: "#6b7280", fontSize: 12, margin: "4px 0 0" }}>
            Track investigation status and decisions
          </p>
        </div>
        {caseData && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Badge label={caseData.status} color={STATUS_COLORS[caseData.status] ?? "#6b7280"} />
            <Badge label={caseData.priority} color={PRIORITY_COLORS[caseData.priority] ?? "#6b7280"} />
          </div>
        )}
      </div>

      {loading && <p style={{ color: "#94a3b8", fontSize: 13 }}>Loading case...</p>}

      {/* No case yet */}
      {!loading && !caseData && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>No active case for this claim.</p>
          <button
            onClick={openCase}
            disabled={saving}
            style={{
              background: "#3b82f6", color: "#fff", border: "none",
              borderRadius: 8, padding: "8px 18px", fontSize: 13,
              fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Opening..." : "+ Open Case"}
          </button>
          {error && <p style={{ color: "#ef4444", fontSize: 12, margin: 0 }}>{error}</p>}
        </div>
      )}

      {/* Active case */}
      {!loading && caseData && (
        <div>
          <div style={{ display: "flex", gap: 24, marginBottom: 16, fontSize: 12, color: "#6b7280" }}>
            <span>Case ID: <strong style={{ color: "#94a3b8", fontFamily: "monospace" }}>{caseData.case_id}</strong></span>
            <span>Assigned: <strong style={{ color: "#94a3b8" }}>{caseData.assigned_to}</strong></span>
            <span>Opened: <strong style={{ color: "#94a3b8" }}>{new Date(caseData.created_at).toLocaleDateString()}</strong></span>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
              INVESTIGATION NOTES
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={!!isClosed}
              placeholder="Add investigation notes..."
              rows={3}
              style={{
                width: "100%", background: "#0f0f1a", border: "1px solid #2d2d4e",
                borderRadius: 8, padding: "10px 12px", color: "#f1f5f9", fontSize: 13,
                resize: "vertical", fontFamily: "inherit", boxSizing: "border-box",
                opacity: isClosed ? 0.5 : 1,
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
              DECISION SUMMARY
            </label>
            <textarea
              value={decision}
              onChange={e => setDecision(e.target.value)}
              disabled={!!isClosed}
              placeholder="Summarize your decision..."
              rows={2}
              style={{
                width: "100%", background: "#0f0f1a", border: "1px solid #2d2d4e",
                borderRadius: 8, padding: "10px 12px", color: "#f1f5f9", fontSize: 13,
                resize: "vertical", fontFamily: "inherit", boxSizing: "border-box",
                opacity: isClosed ? 0.5 : 1,
              }}
            />
          </div>

          {!isClosed && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={saveNotes} disabled={saving} style={{
                background: "#2d2d4e", color: "#94a3b8", border: "1px solid #3d3d5e",
                borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer",
              }}>
                {saving ? "Saving..." : "Save Notes"}
              </button>
              {caseData.status === "OPEN" && (
                <button onClick={() => setStatus("IN_REVIEW")} disabled={saving} style={{
                  background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b44",
                  borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}>
                  Mark In Review
                </button>
              )}
              <button onClick={() => setStatus("CONFIRMED_FRAUD")} disabled={saving} style={{
                background: "#ef444422", color: "#ef4444", border: "1px solid #ef444444",
                borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
                Confirm Fraud
              </button>
              <button onClick={() => setStatus("DISMISSED")} disabled={saving} style={{
                background: "#10b98122", color: "#10b981", border: "1px solid #10b98144",
                borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
                Dismiss
              </button>
            </div>
          )}

          {isClosed && (
            <div style={{
              background: (STATUS_COLORS[caseData.status] ?? "#6b7280") + "15",
              border: `1px solid ${STATUS_COLORS[caseData.status] ?? "#6b7280"}44`,
              borderRadius: 8, padding: "12px 16px",
            }}>
              <p style={{ color: STATUS_COLORS[caseData.status], fontSize: 13, fontWeight: 700, margin: 0 }}>
                {caseData.status === "CONFIRMED_FRAUD"
                  ? "Case closed — Fraud confirmed. Claim label updated in graph."
                  : "Case closed — Dismissed. Claim cleared in graph."}
              </p>
              <p style={{ color: "#6b7280", fontSize: 12, margin: "4px 0 0" }}>
                Closed {new Date(caseData.updated_at).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
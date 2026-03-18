"use client";

import { useState, useEffect, useRef } from "react";
import { apiGet } from "@/lib/api";

type ExtractedDoc = {
  document_id:   string;
  file_name:     string;
  file_type:     string;
  uploaded_at:   string;
  summary:       string;
  document_type: string;
  has_red_flags: boolean;
  contradictions?: string[];
  fraud_signals?:  string[];
};

type ExtractionResult = {
  status:         string;
  document_id:    string;
  has_red_flags:  boolean;
  extracted: {
    summary:        string;
    document_type:  string;
    confidence:     string;
    financial?:     any;
    vehicle?:       any;
    provider?:      any;
    people?:        any[];
    fraud_signals?: string[];
  };
  reconciliation: {
    updated_nodes:  any[];
    created_nodes:  any[];
    contradictions: string[];
    fraud_signals:  string[];
  };
};

type UploadJob = {
  file:      File;
  status:    "pending" | "uploading" | "done" | "error";
  result?:   ExtractionResult;
  error?:    string;
};

function DocTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    police_report:   "#3b82f6",
    medical_record:  "#8b5cf6",
    repair_estimate: "#f59e0b",
    claim_form:      "#10b981",
    invoice:         "#06b6d4",
    other:           "#6b7280",
  };
  const t     = type ?? "other";
  const color = colors[t] ?? "#6b7280";
  return (
    <span style={{
      background: color + "22", color, borderRadius: 999,
      padding: "2px 10px", fontSize: 11, fontWeight: 600,
    }}>
      {t.replace(/_/g, " ").toUpperCase()}
    </span>
  );
}

function RedFlagBanner({ contradictions, signals }: { contradictions: string[]; signals: string[] }) {
  if (!contradictions.length && !signals.length) return null;
  return (
    <div style={{
      background: "#7f1d1d22", border: "1px solid #ef444466",
      borderRadius: 8, padding: "10px 14px", marginTop: 10,
    }}>
      <p style={{ color: "#ef4444", fontWeight: 700, fontSize: 12, margin: "0 0 6px" }}>
        🚨 FRAUD SIGNALS DETECTED
      </p>
      {contradictions.map((c, i) => (
        <p key={i} style={{ color: "#fca5a5", fontSize: 12, margin: "2px 0" }}>⚠ {c}</p>
      ))}
      {signals.map((s, i) => (
        <span key={i} style={{
          display: "inline-block", background: "#ef444422", color: "#ef4444",
          borderRadius: 999, padding: "1px 8px", fontSize: 11,
          fontWeight: 600, marginRight: 4, marginTop: 4,
        }}>{s.replace(/_/g, " ")}</span>
      ))}
    </div>
  );
}

function ExtractionDetails({ result }: { result: ExtractionResult }) {
  const [expanded, setExpanded] = useState(false);
  const ex  = result.extracted;
  const rec = result.reconciliation;

  return (
    <div style={{
      background: "#0f0f1a", border: "1px solid #2d2d4e",
      borderRadius: 10, padding: "14px", marginTop: 8,
    }}>
      <p style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>
        {ex.summary}
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <DocTypeBadge type={ex.document_type} />
        <span style={{
          background: ex.confidence === "high" ? "#10b98122" : ex.confidence === "medium" ? "#f59e0b22" : "#ef444422",
          color:      ex.confidence === "high" ? "#10b981"   : ex.confidence === "medium" ? "#f59e0b"   : "#ef4444",
          borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 600,
        }}>
          {ex.confidence?.toUpperCase()} CONFIDENCE
        </span>
      </div>

      <RedFlagBanner contradictions={rec.contradictions} signals={rec.fraud_signals} />

      {(rec.updated_nodes.length > 0 || rec.created_nodes.length > 0) && (
        <div style={{
          background: "#10b98111", border: "1px solid #10b98133",
          borderRadius: 8, padding: "8px 12px", marginTop: 10,
        }}>
          <p style={{ color: "#10b981", fontSize: 12, fontWeight: 700, margin: "0 0 4px" }}>
            ✓ Graph Updated
          </p>
          {rec.updated_nodes.map((n, i) => (
            <p key={i} style={{ color: "#6ee7b7", fontSize: 11, margin: "1px 0" }}>
              Updated {n.type} — {n.fields?.join(", ")}
            </p>
          ))}
          {rec.created_nodes.map((n, i) => (
            <p key={i} style={{ color: "#6ee7b7", fontSize: 11, margin: "1px 0" }}>
              Created new {n.type}{n.name ? ` (${n.name})` : ""}
            </p>
          ))}
        </div>
      )}

      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          marginTop: 10, background: "none", border: "1px solid #2d2d4e",
          borderRadius: 6, padding: "4px 10px", color: "#6b7280",
          fontSize: 11, cursor: "pointer",
        }}
      >
        {expanded ? "Hide" : "Show"} extracted fields
      </button>

      {expanded && (
        <div style={{ marginTop: 10 }}>
          {ex.financial?.amounts?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <p style={{ color: "#6b7280", fontSize: 11, fontWeight: 600, margin: "0 0 4px" }}>FINANCIAL</p>
              {ex.financial.amounts.map((a: any, i: number) => (
                <p key={i} style={{ color: "#f1f5f9", fontSize: 12, margin: "1px 0" }}>
                  {a.description}: <strong>${a.value?.toLocaleString()}</strong>
                </p>
              ))}
            </div>
          )}
          {ex.vehicle && Object.values(ex.vehicle).some(Boolean) && (
            <div style={{ marginBottom: 8 }}>
              <p style={{ color: "#6b7280", fontSize: 11, fontWeight: 600, margin: "0 0 4px" }}>VEHICLE</p>
              {Object.entries(ex.vehicle).filter(([, v]) => v).map(([k, v]) => (
                <p key={k} style={{ color: "#f1f5f9", fontSize: 12, margin: "1px 0" }}>
                  {k.replace(/_/g, " ")}: <strong>{String(v)}</strong>
                </p>
              ))}
            </div>
          )}
          {ex.provider?.name && (
            <div style={{ marginBottom: 8 }}>
              <p style={{ color: "#6b7280", fontSize: 11, fontWeight: 600, margin: "0 0 4px" }}>PROVIDER</p>
              {Object.entries(ex.provider).filter(([, v]) => v).map(([k, v]) => (
                <p key={k} style={{ color: "#f1f5f9", fontSize: 12, margin: "1px 0" }}>
                  {k.replace(/_/g, " ")}: <strong>{String(v)}</strong>
                </p>
              ))}
            </div>
          )}
          {ex.people?.filter((p: any) => p.name).map((p: any, i: number) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <p style={{ color: "#6b7280", fontSize: 11, fontWeight: 600, margin: "0 0 4px" }}>
                PERSON — {p.role?.toUpperCase()}
              </p>
              {Object.entries(p).filter(([k, v]) => v && k !== "role").map(([k, v]) => (
                <p key={k} style={{ color: "#f1f5f9", fontSize: 12, margin: "1px 0" }}>
                  {k}: <strong>{String(v)}</strong>
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobRow({ job }: { job: UploadJob }) {
  return (
    <div style={{
      background: "#0f0f1a", border: `1px solid ${
        job.status === "error"     ? "#ef444444" :
        job.status === "done" && job.result?.has_red_flags ? "#ef444444" :
        job.status === "done"      ? "#10b98133" :
        "#2d2d4e"
      }`,
      borderRadius: 8, padding: "10px 14px", marginBottom: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        {/* Status icon */}
        {job.status === "pending"   && <span style={{ color: "#6b7280", fontSize: 13 }}>⏳</span>}
        {job.status === "uploading" && <span style={{ color: "#3b82f6", fontSize: 13 }}>🤖</span>}
        {job.status === "done"      && !job.result?.has_red_flags && <span style={{ color: "#10b981", fontSize: 13 }}>✓</span>}
        {job.status === "done"      && job.result?.has_red_flags  && <span style={{ fontSize: 13 }}>🚨</span>}
        {job.status === "error"     && <span style={{ color: "#ef4444", fontSize: 13 }}>✗</span>}

        <p style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600, margin: 0, flex: 1 }}>
          {job.file.name}
        </p>

        <span style={{
          fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 999,
          background:
            job.status === "pending"   ? "#6b728022" :
            job.status === "uploading" ? "#3b82f622" :
            job.status === "done"      ? "#10b98122" :
            "#ef444422",
          color:
            job.status === "pending"   ? "#6b7280" :
            job.status === "uploading" ? "#3b82f6" :
            job.status === "done"      ? "#10b981" :
            "#ef4444",
        }}>
          {job.status === "uploading" ? "Analyzing..." : job.status.toUpperCase()}
        </span>
      </div>

      {job.status === "uploading" && (
        <p style={{ color: "#6b7280", fontSize: 11, margin: 0 }}>
          LlamaParse + Claude extracting entities...
        </p>
      )}
      {job.status === "error" && (
        <p style={{ color: "#ef4444", fontSize: 12, margin: 0 }}>⚠ {job.error}</p>
      )}
      {job.status === "done" && job.result && (
        <ExtractionDetails result={job.result} />
      )}
    </div>
  );
}

export default function DocumentPanel({ claimId }: { claimId: string }) {
  const [docs, setDocs]         = useState<ExtractedDoc[]>([]);
  const [jobs, setJobs]         = useState<UploadJob[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadDocs(); }, [claimId]);

  async function loadDocs() {
    try {
      const data = await apiGet<ExtractedDoc[]>(`/claims/${claimId}/documents`);
      setDocs(data);
    } catch {}
  }

  async function uploadFile(job: UploadJob, index: number): Promise<void> {
    // Mark as uploading
    setJobs(prev => prev.map((j, i) =>
      i === index ? { ...j, status: "uploading" } : j
    ));

    const formData = new FormData();
    formData.append("file", job.file);

    try {
      const token = localStorage.getItem("access_token");
      const res   = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/claims/${claimId}/documents`,
        {
          method:  "POST",
          headers: { Authorization: `Bearer ${token}` },
          body:    formData,
        }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Upload failed");
      }

      const data = await res.json();
      setJobs(prev => prev.map((j, i) =>
        i === index ? { ...j, status: "done", result: data.extraction } : j
      ));
    } catch (e: any) {
      setJobs(prev => prev.map((j, i) =>
        i === index ? { ...j, status: "error", error: e.message || "Upload failed" } : j
      ));
    }
  }

  async function handleFiles(files: File[]) {
    if (!files.length) return;

    const newJobs: UploadJob[] = files.map(file => ({
      file, status: "pending",
    }));

    const startIndex = jobs.length;
    setJobs(prev => [...prev, ...newJobs]);

    // Upload sequentially to avoid overwhelming the API
    for (let i = 0; i < newJobs.length; i++) {
      await uploadFile(newJobs[i], startIndex + i);
    }

    // Refresh document list after all uploads
    await loadDocs();
  }

  async function deleteDoc(docId: string) {
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/claims/${claimId}/documents/${docId}`,
        {
          method:  "DELETE",
          headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
        }
      );
      setDocs(prev => prev.filter(d => d.document_id !== docId));
    } catch {}
  }

  const activeJobs   = jobs.filter(j => j.status === "uploading" || j.status === "pending");
  const isProcessing = activeJobs.length > 0;

  return (
    <div style={{
      background: "#1a1a2e", border: "1px solid #2d2d4e",
      borderRadius: 12, padding: "20px", marginTop: 20,
    }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 16px", color: "#f1f5f9" }}>
        📎 Documents & AI Extraction
      </h3>

      {/* Upload area */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length) handleFiles(files);
        }}
        onClick={() => !isProcessing && fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#3b82f6" : "#2d2d4e"}`,
          borderRadius: 10, padding: "24px",
          textAlign: "center", cursor: isProcessing ? "not-allowed" : "pointer",
          background: dragOver ? "#3b82f611" : "transparent",
          transition: "all 0.15s", marginBottom: 16,
        }}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.txt"
          style={{ display: "none" }}
          onChange={e => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) handleFiles(files);
            e.target.value = "";
          }}
        />
        {isProcessing ? (
          <div>
            <p style={{ color: "#3b82f6", fontSize: 14, fontWeight: 600, margin: 0 }}>
              🤖 Processing {activeJobs.length} file{activeJobs.length > 1 ? "s" : ""}...
            </p>
            <p style={{ color: "#6b7280", fontSize: 12, margin: "4px 0 0" }}>
              LlamaParse + Claude analyzing each document
            </p>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 28, margin: 0 }}>📄</p>
            <p style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, margin: "6px 0 2px" }}>
              Drop files or click to upload
            </p>
            <p style={{ color: "#4b5563", fontSize: 11, margin: 0 }}>
              Multiple files supported — PDF, JPG, PNG, WEBP, TXT — max 10MB each
            </p>
          </div>
        )}
      </div>

      {/* Upload jobs (current session) */}
      {jobs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <p style={{ color: "#4b5563", fontSize: 11, fontWeight: 600, margin: 0, textTransform: "uppercase" }}>
              Current Upload ({jobs.filter(j => j.status === "done").length}/{jobs.length} complete)
            </p>
            {!isProcessing && (
              <button
                onClick={() => setJobs([])}
                style={{
                  background: "none", border: "none", color: "#4b5563",
                  fontSize: 11, cursor: "pointer",
                }}
              >
                Clear
              </button>
            )}
          </div>
          {jobs.map((job, i) => <JobRow key={i} job={job} />)}
        </div>
      )}

      {/* Previously uploaded documents */}
      {docs.length > 0 && (
        <div>
          <p style={{ color: "#4b5563", fontSize: 11, fontWeight: 600, margin: "0 0 8px", textTransform: "uppercase" }}>
            Uploaded Documents ({docs.length})
          </p>
          {docs.map(doc => (
            <div key={doc.document_id} style={{
              background: "#0f0f1a",
              border: `1px solid ${doc.has_red_flags ? "#ef444444" : "#2d2d4e"}`,
              borderRadius: 8, padding: "12px 14px", marginBottom: 8,
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <p style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600, margin: 0 }}>
                    {doc.file_name}
                  </p>
                  {doc.has_red_flags && (
                    <span style={{
                      background: "#ef444422", color: "#ef4444",
                      borderRadius: 999, padding: "1px 8px", fontSize: 10, fontWeight: 700,
                    }}>🚨 RED FLAGS</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <DocTypeBadge type={doc.document_type ?? "other"} />
                  <span style={{ color: "#4b5563", fontSize: 11 }}>
                    {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString() : "—"}
                  </span>
                </div>
                {doc.summary && (
                  <p style={{ color: "#6b7280", fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>
                    {doc.summary}
                  </p>
                )}
              </div>
              <button
                onClick={() => deleteDoc(doc.document_id)}
                style={{
                  background: "none", border: "none", color: "#4b5563",
                  cursor: "pointer", fontSize: 16, padding: "0 4px", flexShrink: 0,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                onMouseLeave={e => (e.currentTarget.style.color = "#4b5563")}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {docs.length === 0 && jobs.length === 0 && (
        <p style={{ color: "#374151", fontSize: 12, textAlign: "center" }}>
          No documents uploaded yet
        </p>
      )}
    </div>
  );
}
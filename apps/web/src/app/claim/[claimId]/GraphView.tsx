"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { apiGet } from "@/lib/api";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

type GraphNode = {
  id: string;
  label: string;
  is_hub: boolean;
  properties: Record<string, any>;
};

type GraphEdge = {
  source: string;
  target: string;
  type: string;
};

type GraphResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type RiskSignal = {
  nodeId: string;
  nodeLabel: string;
  severity: "high" | "medium";
  reasons: string[];
};

type OverlayToggles = {
  sharedBank: boolean;
  rapidReclaim: boolean;
  phantomAdjuster: boolean;
  starburstLabel: boolean;
};

// ─── colours ────────────────────────────────────────────────────────────────

const LABEL_COLORS: Record<string, string> = {
  Claim:        "#3b82f6",
  PolicyHolder: "#10b981",
  Policy:       "#f59e0b",
  Adjuster:     "#8b5cf6",
  BankAccount:  "#f97316",
  Provider:     "#06b6d4",
  Vehicle:      "#84cc16",
};

function nodeColor(label: string, isHub: boolean): string {
  if (isHub) return "#ef4444";
  return LABEL_COLORS[label] ?? "#6b7280";
}

// ─── risk signals ────────────────────────────────────────────────────────────

function computeRiskSignals(
  nodes: any[],
  links: any[]
): { signals: RiskSignal[]; riskNodeIds: Record<string, "high" | "medium"> } {
  const signalMap: Record<string, RiskSignal> = {};
  const riskNodeIds: Record<string, "high" | "medium"> = {};

  const flag = (nodeId: string, nodeLabel: string, severity: "high" | "medium", reason: string) => {
    if (!signalMap[nodeId]) {
      signalMap[nodeId] = { nodeId, nodeLabel, severity, reasons: [] };
    }
    signalMap[nodeId].reasons.push(reason);
    if (!riskNodeIds[nodeId] || severity === "high") {
      riskNodeIds[nodeId] = severity;
      signalMap[nodeId].severity = severity;
    }
  };

  const bankAccountIncoming: Record<string, number> = {};
  for (const link of links) {
    const targetId = typeof link.target === "object" ? link.target.id : link.target;
    const targetNode = nodes.find((n) => n.id === targetId);
    if (targetNode?.label === "BankAccount") {
      bankAccountIncoming[targetId] = (bankAccountIncoming[targetId] ?? 0) + 1;
    }
  }

  for (const node of nodes) {
    const p = node.properties ?? {};

    if (p.label_is_fraud === 1 || p.label_is_fraud === true) {
      flag(node.id, node.label, "high", "Confirmed fraud label");
    }
    if (node.label === "BankAccount" && (bankAccountIncoming[node.id] ?? 0) >= 3) {
      flag(node.id, node.label, "high", `Shared by ${bankAccountIncoming[node.id]} claims`);
    }
    if (p.fraud_scenario !== null && p.fraud_scenario !== undefined && p.fraud_scenario !== "") {
      flag(node.id, node.label, "medium", `Fraud scenario: ${p.fraud_scenario}`);
    }
    if (typeof p.days_to_file === "number" && p.days_to_file <= 3) {
      flag(node.id, node.label, "medium", `Filed ${p.days_to_file} day(s) after incident`);
    }
    if (typeof p.claim_amount === "number" && p.claim_amount > 10000) {
      flag(node.id, node.label, "medium", `High claim amount: $${p.claim_amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
    }
    if (node.label === "Adjuster" && node.is_hub) {
      flag(node.id, node.label, "medium", "Adjuster handling abnormally high claim volume");
    }
  }

  return { signals: Object.values(signalMap), riskNodeIds };
}

// ─── overlay computations ────────────────────────────────────────────────────

function computeOverlayData(nodes: any[], links: any[]) {
  // Shared bank accounts: BankAccount nodes with 3+ incoming claim edges
  const bankIncoming: Record<string, string[]> = {};
  for (const link of links) {
    const srcId = typeof link.source === "object" ? link.source.id : link.source;
    const tgtId = typeof link.target === "object" ? link.target.id : link.target;
    const tgtNode = nodes.find((n) => n.id === tgtId);
    if (tgtNode?.label === "BankAccount") {
      if (!bankIncoming[tgtId]) bankIncoming[tgtId] = [];
      bankIncoming[tgtId].push(srcId);
    }
  }
  const sharedBankIds = new Set(
    Object.entries(bankIncoming)
      .filter(([, claimIds]) => claimIds.length >= 3)
      .map(([bankId]) => bankId)
  );

  // Rapid re-claim edges: edges between claims sharing the same policy
  // We detect this by finding PolicyHolder nodes connected to 3+ claims via Policy
  const policyHolderClaims: Record<string, string[]> = {};
  for (const link of links) {
    const srcId = typeof link.source === "object" ? link.source.id : link.source;
    const tgtId = typeof link.target === "object" ? link.target.id : link.target;
    const srcNode = nodes.find((n) => n.id === srcId);
    const tgtNode = nodes.find((n) => n.id === tgtId);
    if (srcNode?.label === "Policy" && tgtNode?.label === "Claim") {
      if (!policyHolderClaims[srcId]) policyHolderClaims[srcId] = [];
      policyHolderClaims[srcId].push(tgtId);
    }
  }
  // Collect rapid reclaim edge pairs (claim → claim via same policy)
  const rapidReclaimEdges: Array<[string, string]> = [];
  for (const [, claimIds] of Object.entries(policyHolderClaims)) {
    if (claimIds.length >= 2) {
      for (let i = 0; i < claimIds.length; i++) {
        for (let j = i + 1; j < claimIds.length; j++) {
          rapidReclaimEdges.push([claimIds[i], claimIds[j]]);
        }
      }
    }
  }

  // Phantom adjuster: hub adjuster nodes
  const phantomAdjusterIds = new Set(
    nodes
      .filter((n) => n.label === "Adjuster" && n.is_hub)
      .map((n) => n.id)
  );

  // Starburst: hub nodes with connection count
  const hubNodes = nodes.filter((n) => n.isCollapsedHub);

  return { sharedBankIds, rapidReclaimEdges, phantomAdjusterIds, hubNodes };
}

// ─── hub collapse ────────────────────────────────────────────────────────────

function collapseHubs(nodes: GraphNode[], edges: GraphEdge[]) {
  const hubIds = new Set(nodes.filter((n) => n.is_hub).map((n) => n.id));

  const hubEdgeCounts: Record<string, number> = {};
  for (const e of edges) {
    if (hubIds.has(e.source)) hubEdgeCounts[e.source] = (hubEdgeCounts[e.source] ?? 0) + 1;
    if (hubIds.has(e.target)) hubEdgeCounts[e.target] = (hubEdgeCounts[e.target] ?? 0) + 1;
  }

  const seenHubEdges = new Set<string>();
  const collapsedEdges = edges.filter((e) => {
    const srcIsHub = hubIds.has(e.source);
    const tgtIsHub = hubIds.has(e.target);
    if (srcIsHub && tgtIsHub) return false;
    if (srcIsHub) {
      if (seenHubEdges.has(e.source)) return false;
      seenHubEdges.add(e.source);
      return true;
    }
    if (tgtIsHub) {
      if (seenHubEdges.has(e.target)) return false;
      seenHubEdges.add(e.target);
      return true;
    }
    return true;
  });

  const connectedIds = new Set(collapsedEdges.flatMap((e) => [e.source, e.target]));

  const collapsedNodes = nodes
    .filter((n) => !hubIds.has(n.id) && connectedIds.has(n.id))
    .concat(
      nodes
        .filter((n) => hubIds.has(n.id))
        .map((n) => ({
          ...n,
          summaryLabel: `⚠️ ${n.id} (${n.label}) — ${hubEdgeCounts[n.id] ?? 0} connections`,
          isCollapsedHub: true,
          hubConnectionCount: hubEdgeCounts[n.id] ?? 0,
        }))
    );

  return { collapsedNodes, collapsedEdges };
}

// ─── merge ───────────────────────────────────────────────────────────────────

function mergeGraphData(
  existing: { nodes: any[]; links: any[] },
  incoming: { nodes: any[]; links: any[] }
) {
  const existingNodeIds = new Set(existing.nodes.map((n) => n.id));
  const newNodes = incoming.nodes.filter((n) => !existingNodeIds.has(n.id));
  const edgeKey = (e: any) => `${e.source}-${e.target}-${e.type}`;
  const existingEdgeKeys = new Set(existing.links.map(edgeKey));
  const newLinks = incoming.links.filter((e) => !existingEdgeKeys.has(edgeKey(e)));
  return {
    nodes: [...existing.nodes, ...newNodes],
    links: [...existing.links, ...newLinks],
  };
}

function buildGraphData(data: GraphResponse) {
  const { collapsedNodes, collapsedEdges } = collapseHubs(data.nodes, data.edges);
  return {
    nodes: collapsedNodes.map((n: any) => ({
      ...n,
      color: nodeColor(n.label, n.is_hub),
      val: n.is_hub ? 8 : 1,
    })),
    links: collapsedEdges.map((e) => ({
      ...e,
      source: e.source,
      target: e.target,
    })),
  };
}

// ─── NodePanel ───────────────────────────────────────────────────────────────

function NodePanel({ node, riskNodeIds, onClose }: {
  node: any;
  riskNodeIds: Record<string, "high" | "medium">;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (val: string) => {
    navigator.clipboard.writeText(val);
    setCopied(val);
    setTimeout(() => setCopied(null), 1500);
  };

  const color = node.isCollapsedHub ? "#ef4444" : (LABEL_COLORS[node.label] ?? "#6b7280");
  const props: Record<string, any> = node.properties ?? {};
  const risk = riskNodeIds[node.id];

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, width: 300, height: "100%",
      background: "#1a1a2e", borderLeft: "1px solid #2d2d4e",
      borderRadius: "0 8px 8px 0", overflowY: "auto", zIndex: 10,
      padding: "16px 14px", boxSizing: "border-box",
      animation: "slideIn 0.18s ease-out",
    }}>
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>Node details</span>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#9ca3af",
          cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 2,
        }}>×</button>
      </div>

      <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{
          background: color, color: "#fff", borderRadius: 999,
          padding: "3px 12px", fontSize: 13, fontWeight: 600,
        }}>
          {node.isCollapsedHub ? `${node.label} (Hub)` : node.label}
        </span>
        {risk === "high" && (
          <span style={{ background: "#7f1d1d", color: "#fca5a5", borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
            🔴 HIGH RISK
          </span>
        )}
        {risk === "medium" && (
          <span style={{ background: "#78350f", color: "#fcd34d", borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
            🟡 MEDIUM RISK
          </span>
        )}
      </div>

      {node.isCollapsedHub && (
        <p style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>
          ⚠️ High-degree hub — {node.summaryLabel?.split("—")[1]?.trim()}
        </p>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", color: "#6b7280", paddingBottom: 6, fontWeight: 500, width: "40%" }}>Key</th>
            <th style={{ textAlign: "left", color: "#6b7280", paddingBottom: 6, fontWeight: 500 }}>Value</th>
            <th style={{ width: 24 }} />
          </tr>
        </thead>
        <tbody>
          {Object.entries(props).map(([key, val]) => {
            const display = val === null || val === undefined ? "—" : String(val);
            return (
              <tr key={key} style={{ borderTop: "1px solid #2d2d4e" }}>
                <td style={{ padding: "7px 4px 7px 0", color: "#94a3b8", fontWeight: 600, verticalAlign: "top" }}>{key}</td>
                <td style={{ padding: "7px 4px", color: "#e2e8f0", wordBreak: "break-all", verticalAlign: "top" }}>{display}</td>
                <td style={{ verticalAlign: "top", paddingTop: 6 }}>
                  <button onClick={() => copy(display)} title="Copy" style={{
                    background: "none", border: "none",
                    color: copied === display ? "#10b981" : "#4b5563",
                    cursor: "pointer", fontSize: 13, padding: 0,
                  }}>
                    {copied === display ? "✓" : "⧉"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p style={{ marginTop: 16, fontSize: 11, color: "#4b5563", textAlign: "center" }}>
        Double-click node to expand its neighborhood
      </p>
    </div>
  );
}

// ─── RiskPanel ───────────────────────────────────────────────────────────────

function RiskPanel({ signals }: { signals: RiskSignal[] }) {
  const [open, setOpen] = useState(false);  // collapsed by default
  const high   = signals.filter((s) => s.severity === "high");
  const medium = signals.filter((s) => s.severity === "medium");

  return (
    <div style={{
      marginTop: 14,
      background: "#0c0c1e", border: "1px solid #1a1a30",
      borderRadius: 14, overflow: "hidden",
      fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "14px 20px",
          background: "none", border: "none", cursor: "pointer",
          borderBottom: open ? "1px solid #1a1a30" : "none",
          transition: "background 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "#12122a"}
        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "transparent"}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15 }}>⚠️</span>
          <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>Risk Signals</span>
          {signals.length > 0 && (
            <div style={{ display: "flex", gap: 6 }}>
              {high.length > 0 && (
                <span style={{
                  background: "#7f1d1d22", border: "1px solid #ef444433",
                  color: "#f87171", borderRadius: 6,
                  padding: "2px 8px", fontSize: 10, fontWeight: 700,
                }}>{high.length} high</span>
              )}
              {medium.length > 0 && (
                <span style={{
                  background: "#78350f22", border: "1px solid #f59e0b33",
                  color: "#fbbf24", borderRadius: 6,
                  padding: "2px 8px", fontSize: 10, fontWeight: 700,
                }}>{medium.length} medium</span>
              )}
            </div>
          )}
        </div>
        <span style={{ color: "#374151", fontSize: 11 }}>{open ? "▲ collapse" : "▼ expand"}</span>
      </button>

      {open && (
        <div style={{ padding: "16px 20px" }}>
          {signals.length === 0 && (
            <p style={{ color: "#374151", fontSize: 12, margin: 0 }}>No risk signals detected in current view.</p>
          )}

          {high.length > 0 && (
            <div style={{ marginBottom: medium.length > 0 ? 16 : 0 }}>
              <p style={{ color: "#f87171", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 8px" }}>
                🔴 High Risk
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {high.map((s, i) => (
                  <div key={i} style={{
                    background: "#09091a",
                    border: "1px solid #f8717122",
                    borderLeft: "3px solid #f87171",
                    borderRadius: 8, padding: "10px 14px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ color: "#f87171", fontWeight: 700, fontSize: 12 }}>{s.nodeId}</span>
                      <span style={{
                        background: "#f8717118", color: "#f87171",
                        borderRadius: 4, padding: "1px 7px", fontSize: 10, fontWeight: 700,
                      }}>{s.nodeLabel}</span>
                    </div>
                    {s.reasons.map((r, j) => (
                      <p key={j} style={{ color: "#6b7280", fontSize: 11, margin: j > 0 ? "3px 0 0" : 0 }}>· {r}</p>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {medium.length > 0 && (
            <div>
              <p style={{ color: "#fbbf24", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 8px" }}>
                🟡 Medium Risk
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {medium.map((s, i) => (
                  <div key={i} style={{
                    background: "#09091a",
                    border: "1px solid #fbbf2422",
                    borderLeft: "3px solid #fbbf24",
                    borderRadius: 8, padding: "10px 14px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: 12 }}>{s.nodeId}</span>
                      <span style={{
                        background: "#fbbf2418", color: "#fbbf24",
                        borderRadius: 4, padding: "1px 7px", fontSize: 10, fontWeight: 700,
                      }}>{s.nodeLabel}</span>
                    </div>
                    {s.reasons.map((r, j) => (
                      <p key={j} style={{ color: "#6b7280", fontSize: 11, margin: j > 0 ? "3px 0 0" : 0 }}>· {r}</p>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── OverlayToolbar ──────────────────────────────────────────────────────────

function OverlayToolbar({ toggles, onChange }: {
  toggles: OverlayToggles;
  onChange: (key: keyof OverlayToggles) => void;
}) {
  const buttons: Array<{ key: keyof OverlayToggles; label: string; color: string }> = [
    { key: "sharedBank",      label: "🏦 Shared Bank",      color: "#ef4444" },
    { key: "rapidReclaim",    label: "⚡ Rapid Re-claim",   color: "#f59e0b" },
    { key: "phantomAdjuster", label: "👤 Phantom Adjuster", color: "#8b5cf6" },
    { key: "starburstLabel",  label: "💥 Starburst Label",  color: "#f97316" },
  ];

  return (
    <div style={{
      display: "flex", gap: 8, flexWrap: "wrap",
      padding: "8px 12px", background: "#0f0f1a",
      border: "1px solid #2d2d4e", borderRadius: 8, marginBottom: 8,
    }}>
      <span style={{ color: "#6b7280", fontSize: 12, alignSelf: "center", marginRight: 4 }}>
        Overlays:
      </span>
      {buttons.map(({ key, label, color }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: "4px 10px", borderRadius: 999, fontSize: 12,
            cursor: "pointer", fontWeight: 600, transition: "all 0.15s",
            background: toggles[key] ? color : "transparent",
            border: `1px solid ${color}`,
            color: toggles[key] ? "#fff" : color,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── GraphView ───────────────────────────────────────────────────────────────

export default function GraphView({ claimId }: { claimId: string }) {
  const [graphData, setGraphData]       = useState<{ nodes: any[]; links: any[] } | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [expanding, setExpanding]       = useState<string | null>(null);
  const [expandedIds, setExpandedIds]   = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [rawCounts, setRawCounts]       = useState({ nodes: 0, edges: 0 });
  const [signals, setSignals]           = useState<RiskSignal[]>([]);
  const [riskNodeIds, setRiskNodeIds]   = useState<Record<string, "high" | "medium">>({});
  const [overlays, setOverlays]         = useState<OverlayToggles>({
    sharedBank: false,
    rapidReclaim: false,
    phantomAdjuster: false,
    starburstLabel: false,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const clickTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleOverlay = useCallback((key: keyof OverlayToggles) => {
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const updateRiskSignals = useCallback((data: { nodes: any[]; links: any[] }) => {
    const { signals, riskNodeIds } = computeRiskSignals(data.nodes, data.links);
    setSignals(signals);
    setRiskNodeIds(riskNodeIds);
  }, []);

  // Initial load
  useEffect(() => {
    apiGet<GraphResponse>(
      `/graph/neighborhood?node_id=${encodeURIComponent(claimId)}&node_label=Claim&depth=2`
    )
      .then((data) => {
        setRawCounts({ nodes: data.nodes.length, edges: data.edges.length });
        const built = buildGraphData(data);
        setGraphData(built);
        setExpandedIds(new Set([claimId]));
        updateRiskSignals(built);
      })
      .catch((e: any) => setError(e?.message ?? "Failed to load graph"))
      .finally(() => setLoading(false));
  }, [claimId, updateRiskSignals]);

  // Click handler
  const handleNodeClick = useCallback(
    (node: any) => {
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;

        const id: string    = node.id;
        const label: string = node.label;
        if (expandedIds.has(id) || node.isCollapsedHub) return;

        setExpanding(id);
        apiGet<GraphResponse>(
          `/graph/neighborhood?node_id=${encodeURIComponent(id)}&node_label=${encodeURIComponent(label)}&depth=1`
        )
          .then((data) => {
            const incoming = buildGraphData(data);
            setGraphData((prev) => {
              const merged = prev ? mergeGraphData(prev, incoming) : incoming;
              updateRiskSignals(merged);
              return merged;
            });
            setExpandedIds((prev) => new Set([...prev, id]));
          })
          .catch((e: any) => setError(e?.message ?? "Failed to expand node"))
          .finally(() => setExpanding(null));
      } else {
        clickTimer.current = setTimeout(() => {
          clickTimer.current = null;
          setSelectedNode(node);
        }, 300);
      }
    },
    [expandedIds, updateRiskSignals]
  );

  if (loading) return <p style={{ marginTop: 12 }}>Loading graph...</p>;
  if (error)   return <p style={{ marginTop: 12, color: "red" }}>Graph error: {error}</p>;
  if (!graphData || graphData.nodes.length === 0) return <p>No graph data found.</p>;

  // Compute overlay data from current graph
  const overlayData = computeOverlayData(graphData.nodes, graphData.links);

  return (
    <div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, fontSize: 13 }}>
        {Object.entries(LABEL_COLORS).map(([label, color]) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: color, display: "inline-block" }} />
            {label}
          </span>
        ))}
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
          Hub (risk)
        </span>
        <span style={{ marginLeft: "auto", color: "#9ca3af", fontSize: 12 }}>
          Click to inspect · Double-click to expand
        </span>
      </div>

      {/* Overlay toolbar */}
      <OverlayToolbar toggles={overlays} onChange={toggleOverlay} />

      {expanding && (
        <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 8 }}>Expanding {expanding}...</p>
      )}

      {/* Graph canvas */}
      <div ref={containerRef} style={{ position: "relative", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
        <ForceGraph2D
          graphData={graphData}
          width={900}
          height={600}
          onNodeClick={handleNodeClick}
          nodeLabel={(node: any) =>
            node.isCollapsedHub ? node.summaryLabel : `${node.label}: ${node.id}`
          }
          nodeColor={(node: any) => {
            if (selectedNode?.id === node.id) return "#ffffff";
            if (expandedIds.has(node.id) && node.id !== claimId) return node.color + "99";
            return node.color;
          }}
          nodeRelSize={6}
          nodeVal={(node: any) => node.val ?? 1}
          linkLabel={(link: any) => link.type}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkColor={(link: any) => {
            if (overlays.rapidReclaim) {
              const srcId = typeof link.source === "object" ? link.source.id : link.source;
              const tgtId = typeof link.target === "object" ? link.target.id : link.target;
              const isRapid = overlayData.rapidReclaimEdges.some(
                ([a, b]) => (a === srcId && b === tgtId) || (a === tgtId && b === srcId)
              );
              if (isRapid) return "#f59e0b";
            }
            return "#cbd5e1";
          }}
          linkWidth={(link: any) => {
            if (overlays.rapidReclaim) {
              const srcId = typeof link.source === "object" ? link.source.id : link.source;
              const tgtId = typeof link.target === "object" ? link.target.id : link.target;
              const isRapid = overlayData.rapidReclaimEdges.some(
                ([a, b]) => (a === srcId && b === tgtId) || (a === tgtId && b === srcId)
              );
              if (isRapid) return 3;
            }
            return 1;
          }}
          nodeCanvasObjectMode={() => "after"}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const risk = riskNodeIds[node.id];

            // ── Overlay: shared bank account ring ──
            if (overlays.sharedBank && overlayData.sharedBankIds.has(node.id)) {
              ctx.beginPath();
              ctx.arc(node.x, node.y, 6 * 2.4, 0, 2 * Math.PI);
              ctx.strokeStyle = "#ef4444";
              ctx.lineWidth = 2 / globalScale;
              ctx.setLineDash([4 / globalScale, 3 / globalScale]);
              ctx.stroke();
              ctx.setLineDash([]);

              // Label
              ctx.font = `${10 / globalScale}px Sans-Serif`;
              ctx.fillStyle = "#ef4444";
              ctx.textAlign = "center";
              ctx.fillText("SHARED ACCT", node.x, node.y - 6 * 2.8);
            }

            // ── Overlay: phantom adjuster ring ──
            if (overlays.phantomAdjuster && overlayData.phantomAdjusterIds.has(node.id)) {
              ctx.beginPath();
              ctx.arc(node.x, node.y, 6 * 2.4, 0, 2 * Math.PI);
              ctx.strokeStyle = "#8b5cf6";
              ctx.lineWidth = 2 / globalScale;
              ctx.setLineDash([6 / globalScale, 3 / globalScale]);
              ctx.stroke();
              ctx.setLineDash([]);

              ctx.font = `${10 / globalScale}px Sans-Serif`;
              ctx.fillStyle = "#8b5cf6";
              ctx.textAlign = "center";
              ctx.fillText("PHANTOM ADJ", node.x, node.y - 6 * 2.8);
            }

            // ── Overlay: starburst label on hub ──
            if (overlays.starburstLabel && node.isCollapsedHub) {
              const count = node.hubConnectionCount ?? 0;
              ctx.font = `bold ${11 / globalScale}px Sans-Serif`;
              ctx.fillStyle = "#f97316";
              ctx.textAlign = "center";
              ctx.fillText(`${count} claims`, node.x, node.y + 6 * 2.8);
            }

            // ── Risk glow rings ──
            if (risk === "high") {
              ctx.beginPath();
              ctx.arc(node.x, node.y, 6 * 1.8, 0, 2 * Math.PI);
              ctx.strokeStyle = "#ef4444";
              ctx.lineWidth = 2 / globalScale;
              ctx.stroke();
            } else if (risk === "medium") {
              ctx.beginPath();
              ctx.arc(node.x, node.y, 6 * 1.8, 0, 2 * Math.PI);
              ctx.strokeStyle = "#f59e0b";
              ctx.lineWidth = 2 / globalScale;
              ctx.stroke();
            }

            // ── Selected node ring ──
            if (selectedNode?.id === node.id) {
              ctx.beginPath();
              ctx.arc(node.x, node.y, 6 * 1.6, 0, 2 * Math.PI);
              ctx.strokeStyle = "#ffffff";
              ctx.lineWidth = 2 / globalScale;
              ctx.stroke();
            }

            // ── Subtle unexpanded ring ──
            if (!expandedIds.has(node.id) && !node.isCollapsedHub && !risk) {
              ctx.beginPath();
              ctx.arc(node.x, node.y, 6 * 1.4, 0, 2 * Math.PI);
              ctx.strokeStyle = "rgba(255,255,255,0.2)";
              ctx.lineWidth = 1 / globalScale;
              ctx.stroke();
            }
          }}
        />

        {selectedNode && (
          <NodePanel
            node={selectedNode}
            riskNodeIds={riskNodeIds}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
        {graphData.nodes.length} nodes · {graphData.links.length} edges shown
        {" "}({rawCounts.nodes} total · {rawCounts.edges} edges before hub collapse)
        {" "}· {expandedIds.size} node{expandedIds.size !== 1 ? "s" : ""} expanded
      </p>

      <RiskPanel signals={signals} />
    </div>
  );
}
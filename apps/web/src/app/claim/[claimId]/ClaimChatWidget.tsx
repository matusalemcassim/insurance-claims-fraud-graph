"use client";

import { useState, useEffect, useRef } from "react";

type Message = {
  role:    "user" | "assistant";
  content: string;
};

type ClaimContext = {
  claimId:       string;
  claimAmount?:  number | null;
  claimType?:    string | null;
  status?:       string | null;
  fraudScenario?: string | null;
  labelIsFraud?: number;
};

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 4, padding: "10px 14px", alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: "50%", background: "#3b82f6",
          animation: "bounce 1.2s infinite",
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const SUGGESTIONS = [
  "What fraud signals does this claim have?",
  "Who is the policyholder?",
  "Are there other claims linked to this bank account?",
  "Does the repair estimate match the claim amount?",
  "Show me claims with the same fraud scenario",
  "What is the adjuster history on this claim?",
];

export default function ClaimChatWidget({ context }: { context: ClaimContext }) {
  const [open, setOpen]           = useState(true);
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // Load persisted history when widget mounts
  useEffect(() => {
    loadHistory();
  }, [context.claimId]);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const token = localStorage.getItem("access_token");
      const res   = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/chat/claim/${context.claimId}/history`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages?.length > 0) {
        setMessages(
          data.messages
            .filter((m: any) => m.role === "user" || m.role === "assistant")
            .map((m: any) => ({ role: m.role, content: m.content }))
        );
      }
    } catch {}
    finally { setHistoryLoading(false); }
  }

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: "user", content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const token = localStorage.getItem("access_token");
      const res   = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/chat`,
        {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            message:    text.trim(),
            session_id: sessionId,
            claim_context: {
              claim_id:       context.claimId,
              claim_amount:   context.claimAmount,
              claim_type:     context.claimType,
              status:         context.status,
              fraud_scenario: context.fraudScenario,
              label_is_fraud: context.labelIsFraud,
            },
          }),
        }
      );

      if (!res.ok) throw new Error("Request failed");

      const data = await res.json();
      if (data.session_id) setSessionId(data.session_id);

      setMessages(prev => [...prev, {
        role:    "assistant",
        content: data.answer ?? data.response ?? "I couldn't generate a response.",
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role:    "assistant",
        content: "Something went wrong. Please try again.",
      }]);
    } finally {
      setLoading(false);
    }
  }

  const fraudColor =
    context.labelIsFraud === 1 ? "#ef4444" :
    context.fraudScenario      ? "#f59e0b" : "#10b981";

  const fraudLabel =
    context.labelIsFraud === 1 ? "🔴 Confirmed Fraud" :
    context.fraudScenario      ? "🟡 Potential Fraud" : "✅ No Flag";

  const hasHistory = messages.length > 0;

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Ask AI about this claim"
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 1000,
          width: 52, height: 52, borderRadius: "50%",
          background: open ? "#1e3a5f" : "#1e40af",
          border: "2px solid #3b82f6",
          cursor: "pointer", fontSize: 22,
          boxShadow: "0 4px 24px #3b82f644",
          transition: "all 0.2s",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {open ? "✕" : "🔍"}
        {/* Dot indicator when there's history */}
        {!open && hasHistory && (
          <span style={{
            position: "absolute", top: 2, right: 2,
            width: 10, height: 10, borderRadius: "50%",
            background: "#10b981", border: "2px solid #0f0f1a",
          }} />
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: 88, right: 24, zIndex: 999,
          width: 420, height: 560,
          background: "#0f0f1a", border: "1px solid #2d2d4e",
          borderRadius: 14, display: "flex", flexDirection: "column",
          boxShadow: "0 8px 40px #00000088",
          overflow: "hidden",
        }}>

          {/* Header */}
          <div style={{
            background: "#1a1a2e", borderBottom: "1px solid #2d2d4e",
            padding: "12px 16px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>🔍</span>
              <div style={{ flex: 1 }}>
                <p style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, margin: 0 }}>
                  Claim Investigator
                </p>
                <p style={{ color: "#10b981", fontSize: 11, margin: 0 }}>
                  ● Focused on this claim
                  {hasHistory && (
                    <span style={{ color: "#4b5563", marginLeft: 8 }}>
                      · {messages.length} messages in history
                    </span>
                  )}
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{
                  background: fraudColor + "22", color: fraudColor,
                  borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700,
                }}>
                  {fraudLabel}
                </span>
                {hasHistory && (
                  <button
                    onClick={async () => {
                      const sid = `${localStorage.getItem("user_id") || "user"}-claim-${context.claimId}`;
                      await fetch(
                        `${process.env.NEXT_PUBLIC_API_BASE_URL}/chat/${sid}`,
                        {
                          method: "DELETE",
                          headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
                        }
                      );
                      setMessages([]);
                      setSessionId(null);
                    }}
                    style={{
                      background: "none", border: "none", color: "#4b5563",
                      fontSize: 10, cursor: "pointer", padding: 0,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#4b5563")}
                  >
                    Clear history
                  </button>
                )}
              </div>
            </div>

            {/* Claim context pill */}
            <div style={{
              background: "#0f0f1a", border: "1px solid #2d2d4e",
              borderRadius: 8, padding: "6px 10px",
              display: "flex", gap: 12, flexWrap: "wrap",
            }}>
              <span style={{ color: "#6b7280", fontSize: 11 }}>
                <span style={{ color: "#94a3b8", fontWeight: 600 }}>Claim: </span>
                <span style={{ color: "#f1f5f9", fontFamily: "monospace" }}>{context.claimId}</span>
              </span>
              {context.claimType && (
                <span style={{ color: "#6b7280", fontSize: 11 }}>
                  <span style={{ color: "#94a3b8", fontWeight: 600 }}>Type: </span>
                  <span style={{ color: "#3b82f6" }}>{context.claimType}</span>
                </span>
              )}
              {context.claimAmount != null && (
                <span style={{ color: "#6b7280", fontSize: 11 }}>
                  <span style={{ color: "#94a3b8", fontWeight: 600 }}>Amount: </span>
                  <span style={{ color: "#10b981" }}>
                    ${context.claimAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                </span>
              )}
              {context.fraudScenario && (
                <span style={{ color: "#6b7280", fontSize: 11 }}>
                  <span style={{ color: "#94a3b8", fontWeight: 600 }}>Scenario: </span>
                  <span style={{ color: "#f59e0b" }}>{context.fraudScenario.replace(/_/g, " ")}</span>
                </span>
              )}
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: "auto", padding: "14px 14px 0",
            display: "flex", flexDirection: "column", gap: 10,
          }}>

            {historyLoading && (
              <p style={{ color: "#4b5563", fontSize: 12, textAlign: "center" }}>
                Loading conversation history...
              </p>
            )}

            {!historyLoading && messages.length === 0 && (
              <div>
                <p style={{ color: "#4b5563", fontSize: 12, textAlign: "center", marginBottom: 14 }}>
                  Ask me anything about this claim
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(s)}
                      style={{
                        background: "#1a1a2e", border: "1px solid #2d2d4e",
                        borderRadius: 8, padding: "8px 12px",
                        color: "#94a3b8", fontSize: 12, cursor: "pointer",
                        textAlign: "left", transition: "border-color 0.15s",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = "#3b82f6")}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = "#2d2d4e")}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{
                display: "flex",
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              }}>
                <div style={{
                  maxWidth: "85%",
                  background: msg.role === "user" ? "#1e40af" : "#1a1a2e",
                  border: msg.role === "user" ? "1px solid #3b82f6" : "1px solid #2d2d4e",
                  borderRadius: msg.role === "user"
                    ? "14px 14px 4px 14px"
                    : "14px 14px 14px 4px",
                  padding: "10px 13px",
                  color: "#f1f5f9", fontSize: 13, lineHeight: 1.5,
                }}>
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{
                  background: "#1a1a2e", border: "1px solid #2d2d4e",
                  borderRadius: "14px 14px 14px 4px",
                }}>
                  <TypingDots />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: "10px 12px", borderTop: "1px solid #2d2d4e",
            display: "flex", gap: 8, alignItems: "flex-end",
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="Ask about this claim... (Enter to send)"
              rows={1}
              style={{
                flex: 1, background: "#1a1a2e", border: "1px solid #2d2d4e",
                borderRadius: 8, padding: "8px 12px", color: "#f1f5f9",
                fontSize: 13, resize: "none", outline: "none",
                maxHeight: 80, lineHeight: 1.5, fontFamily: "inherit",
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              style={{
                width: 36, height: 36, borderRadius: 8, border: "none",
                background: input.trim() && !loading ? "#3b82f6" : "#1a1a2e",
                color: input.trim() && !loading ? "#fff" : "#4b5563",
                cursor: input.trim() && !loading ? "pointer" : "not-allowed",
                fontSize: 16, display: "flex", alignItems: "center",
                justifyContent: "center", flexShrink: 0,
                transition: "background 0.15s",
              }}
            >↑</button>
          </div>
        </div>
      )}
    </>
  );
}
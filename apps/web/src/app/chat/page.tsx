"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { getUser } from "@/lib/auth";

type Message = {
  role: "user" | "assistant";
  content: string;
  cypher?: string | null;
  type?: string;
};

type Session = {
  session_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

const SUGGESTIONS = [
  "What claim has the highest claim amount?",
  "Show me all bank accounts with more than 5 claims",
  "How many confirmed fraud claims are there?",
  "Which adjuster has handled the most claims?",
  "Show me all AUTO claims over $50,000",
  "What are the top 5 fraud scenarios by count?",
  "Show claims filed within 2 days",
  "Which policyholders have more than 3 claims?",
];

function UserAvatar() {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: "50%",
      background: "#3b82f622", border: "1px solid #3b82f644",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 14, color: "#3b82f6", fontWeight: 700, flexShrink: 0,
    }}>U</div>
  );
}

function AgentAvatar() {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: "50%",
      background: "#8b5cf622", border: "1px solid #8b5cf644",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 16, flexShrink: 0,
    }}>🤖</div>
  );
}

function CypherBlock({ cypher }: { cypher: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{
      marginTop: 10, background: "#0f0f1a", border: "1px solid #2d2d4e",
      borderRadius: 8, overflow: "hidden",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "6px 12px", background: "#1a1a2e", borderBottom: "1px solid #2d2d4e",
      }}>
        <span style={{ color: "#6b7280", fontSize: 11, fontWeight: 600 }}>CYPHER QUERY</span>
        <button
          onClick={() => { navigator.clipboard.writeText(cypher); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          style={{ background: "none", border: "none", color: copied ? "#10b981" : "#6b7280", fontSize: 11, cursor: "pointer", fontWeight: 600 }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre style={{
        margin: 0, padding: "12px", color: "#a78bfa", fontSize: 12,
        fontFamily: "monospace", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>{cypher}</pre>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "flex-start",
      flexDirection: isUser ? "row-reverse" : "row", marginBottom: 20,
    }}>
      {isUser ? <UserAvatar /> : <AgentAvatar />}
      <div style={{ maxWidth: "75%" }}>
        <div style={{
          background: isUser ? "#3b82f622" : "#1a1a2e",
          border: `1px solid ${isUser ? "#3b82f644" : "#2d2d4e"}`,
          borderRadius: isUser ? "12px 4px 12px 12px" : "4px 12px 12px 12px",
          padding: "12px 16px",
        }}>
          <p style={{ color: "#f1f5f9", fontSize: 14, margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {msg.content}
          </p>
        </div>
        {msg.cypher && <CypherBlock cypher={msg.cypher} />}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 20 }}>
      <AgentAvatar />
      <div style={{
        background: "#1a1a2e", border: "1px solid #2d2d4e",
        borderRadius: "4px 12px 12px 12px", padding: "14px 18px",
        display: "flex", gap: 6, alignItems: "center",
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: "50%", background: "#6b7280",
            animation: "bounce 1.2s infinite", animationDelay: `${i * 0.2}s`,
          }} />
        ))}
      </div>
      <style>{`@keyframes bounce { 0%,60%,100%{transform:translateY(0);opacity:.4} 30%{transform:translateY(-6px);opacity:1} }`}</style>
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const user = getUser();
  const [messages, setMessages]   = useState<Message[]>([]);
  const [sessions, setSessions]   = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadSessions(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  async function loadSessions() {
    try { setSessions(await apiGet<Session[]>("/chat/sessions")); } catch {}
  }

  async function loadHistory(sid: string) {
    setLoadingHistory(true);
    setSessionId(sid);
    try { setMessages(await apiGet<Message[]>(`/chat/history/${sid}`)); }
    catch { setMessages([]); }
    finally { setLoadingHistory(false); }
  }

  function newSession() {
    setSessionId(null);
    setMessages([]);
    inputRef.current?.focus();
  }

  async function deleteSession(sid: string, e: React.MouseEvent) {
    e.stopPropagation();
    try { await apiPost(`/chat/${sid}`, {}); } catch {}
    setSessions(prev => prev.filter(s => s.session_id !== sid));
    if (sessionId === sid) newSession();
  }

  async function sendMessage(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: msg }]);
    setLoading(true);
    try {
      const res = await apiPost<any>("/chat", { message: msg, session_id: sessionId });
      if (!sessionId) { setSessionId(res.session_id); await loadSessions(); }
      setMessages(prev => [...prev, {
        role: "assistant", content: res.answer,
        cypher: res.cypher, type: res.type,
      }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0f0f1a", color: "#f1f5f9" }}>

      {/* Sidebar */}
      {showSidebar && (
        <div style={{ width: 260, background: "#1a1a2e", borderRight: "1px solid #2d2d4e", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: 16, borderBottom: "1px solid #2d2d4e" }}>
            <button onClick={() => router.push("/")} style={{
              background: "none", border: "1px solid #2d2d4e", borderRadius: 8,
              padding: "6px 12px", color: "#94a3b8", fontSize: 12, cursor: "pointer",
              marginBottom: 10, width: "100%", textAlign: "left",
            }}>← Back to Dashboard</button>
            <button onClick={newSession} style={{
              background: "#3b82f6", border: "none", borderRadius: 8,
              padding: "8px 12px", color: "#fff", fontSize: 13,
              fontWeight: 600, cursor: "pointer", width: "100%",
            }}>+ New Conversation</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
            <p style={{ color: "#4b5563", fontSize: 11, fontWeight: 600, padding: "4px 8px", margin: "4px 0" }}>RECENT CONVERSATIONS</p>
            {sessions.length === 0 && <p style={{ color: "#4b5563", fontSize: 12, padding: 8, textAlign: "center" }}>No conversations yet</p>}
            {sessions.map(s => (
              <div key={s.session_id} onClick={() => loadHistory(s.session_id)} style={{
                padding: "10px", borderRadius: 8, cursor: "pointer", marginBottom: 2,
                background: sessionId === s.session_id ? "#2d2d4e" : "transparent",
                border: sessionId === s.session_id ? "1px solid #3d3d5e" : "1px solid transparent",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ color: "#94a3b8", fontSize: 11, margin: 0, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.session_id}
                  </p>
                  <p style={{ color: "#4b5563", fontSize: 11, margin: "2px 0 0" }}>
                    {s.message_count} msgs · {new Date(s.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <button onClick={e => deleteSession(s.session_id, e)} style={{
                  background: "none", border: "none", color: "#4b5563",
                  cursor: "pointer", fontSize: 16, padding: "0 4px", flexShrink: 0,
                }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#4b5563")}
                >×</button>
              </div>
            ))}
          </div>

          {user && (
            <div style={{ padding: "12px 16px", borderTop: "1px solid #2d2d4e", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", background: "#3b82f622",
                border: "1px solid #3b82f644", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 12, color: "#3b82f6", fontWeight: 700,
              }}>{user.username[0].toUpperCase()}</div>
              <div>
                <p style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600, margin: 0 }}>{user.username}</p>
                <p style={{ color: "#4b5563", fontSize: 11, margin: 0 }}>{user.role}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* Header */}
        <div style={{ padding: "14px 24px", borderBottom: "1px solid #2d2d4e", display: "flex", alignItems: "center", gap: 12, background: "#1a1a2e" }}>
          <button onClick={() => setShowSidebar(v => !v)} style={{
            background: "none", border: "1px solid #2d2d4e", borderRadius: 6,
            padding: "4px 8px", color: "#6b7280", cursor: "pointer", fontSize: 14,
          }}>☰</button>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Fraud Investigation Agent</h1>
            <p style={{ color: "#6b7280", fontSize: 12, margin: 0 }}>Ask questions about claims, patterns, and fraud data</p>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
          {messages.length === 0 && !loadingHistory && (
            <div style={{ maxWidth: 600, margin: "0 auto" }}>
              <div style={{ textAlign: "center", marginBottom: 32 }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Fraud Investigation Agent</h2>
                <p style={{ color: "#6b7280", fontSize: 14, margin: "8px 0 0" }}>
                  Ask me anything about your claims data. I will generate and run Cypher queries against your Neo4j graph.
                </p>
              </div>
              <p style={{ color: "#4b5563", fontSize: 12, fontWeight: 600, marginBottom: 12 }}>TRY ASKING</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => sendMessage(s)} style={{
                    background: "#1a1a2e", border: "1px solid #2d2d4e", borderRadius: 8,
                    padding: "10px 14px", color: "#94a3b8", fontSize: 12,
                    cursor: "pointer", textAlign: "left", lineHeight: 1.4,
                  }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#3b82f6"; (e.currentTarget as HTMLButtonElement).style.color = "#f1f5f9"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#2d2d4e"; (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}
                  >{s}</button>
                ))}
              </div>
            </div>
          )}
          {loadingHistory && <p style={{ color: "#6b7280", textAlign: "center" }}>Loading conversation...</p>}
          <div style={{ maxWidth: 800, margin: "0 auto" }}>
            {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
            {loading && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div style={{ padding: "16px 32px 24px", borderTop: "1px solid #2d2d4e", background: "#1a1a2e" }}>
          <div style={{ maxWidth: 800, margin: "0 auto", display: "flex", gap: 12, alignItems: "flex-end" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Ask about claims, fraud patterns, or any data question... (Enter to send)"
              rows={1}
              style={{
                flex: 1, background: "#0f0f1a", border: "1px solid #2d2d4e",
                borderRadius: 10, padding: "12px 16px", color: "#f1f5f9",
                fontSize: 14, resize: "none", fontFamily: "inherit",
                lineHeight: 1.5, outline: "none", maxHeight: 120, overflowY: "auto",
              }}
              onInput={e => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }}
              onFocus={e => (e.currentTarget.style.borderColor = "#3b82f6")}
              onBlur={e => (e.currentTarget.style.borderColor = "#2d2d4e")}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              style={{
                background: input.trim() && !loading ? "#3b82f6" : "#2d2d4e",
                border: "none", borderRadius: 10, padding: "12px 20px",
                color: input.trim() && !loading ? "#fff" : "#4b5563",
                fontSize: 14, fontWeight: 600,
                cursor: input.trim() && !loading ? "pointer" : "not-allowed",
                flexShrink: 0, transition: "background 0.15s",
              }}
            >{loading ? "..." : "Send"}</button>
          </div>
          <p style={{ color: "#4b5563", fontSize: 11, textAlign: "center", margin: "8px 0 0" }}>
            Queries run directly against your Neo4j graph database
          </p>
        </div>
      </div>
    </div>
  );
}
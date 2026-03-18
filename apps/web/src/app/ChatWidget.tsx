"use client";

import { useState, useEffect, useRef } from "react";
import { apiGet, apiPost} from "@/lib/api";
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
  last_message: string | null;
};

const SUGGESTIONS = [
  "What claim has the highest amount?",
  "Which bank accounts have more than 5 claims?",
  "How many confirmed fraud claims are there?",
  "Top 5 fraud scenarios by count?",
  "Show AUTO claims over $50,000",
  "Which adjusters handled the most claims?",
];

function TypingIndicator() {
  return (
    <div style={{
      display: "flex", gap: 6, alignItems: "center", padding: "10px 12px",
      background: "#1a1a2e", border: "1px solid #2d2d4e",
      borderRadius: "4px 12px 12px 12px", alignSelf: "flex-start",
    }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: "50%", background: "#6b7280",
          animation: "bounce 1.2s infinite", animationDelay: `${i * 0.2}s`,
        }} />
      ))}
      <style>{`@keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-5px);opacity:1}}`}</style>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: "85%",
        background: isUser ? "#3b82f622" : "#1a1a2e",
        border: `1px solid ${isUser ? "#3b82f644" : "#2d2d4e"}`,
        borderRadius: isUser ? "12px 4px 12px 12px" : "4px 12px 12px 12px",
        padding: "10px 12px",
      }}>
        <p style={{ color: "#f1f5f9", fontSize: 13, margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {msg.content}
        </p>
      </div>
    </div>
  );
}

function SessionItem({
  session, active, onClick, onDelete,
}: {
  session: Session;
  active: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const date = new Date(session.updated_at);
  const now  = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const label = isToday
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div
      onClick={onClick}
      style={{
        padding: "8px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 2,
        background: active ? "#2d2d4e" : "transparent",
        border: active ? "1px solid #3d3d5e" : "1px solid transparent",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 6,
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "#1f1f3a"; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{
          color: active ? "#f1f5f9" : "#94a3b8", fontSize: 12, margin: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontWeight: active ? 600 : 400,
        }}>
          {session.last_message
            ? session.last_message.length > 28
                ? session.last_message.slice(0, 28) + "..."
                : session.last_message
            : "New conversation"}
        </p>
        <p style={{ color: "#4b5563", fontSize: 10, margin: "2px 0 0" }}>
          {session.message_count} msgs · {label}
        </p>
      </div>
      <button
        onClick={onDelete}
        style={{
          background: "none", border: "none", color: "#4b5563",
          cursor: "pointer", fontSize: 14, padding: "0 2px", flexShrink: 0,
          lineHeight: 1,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
        onMouseLeave={e => (e.currentTarget.style.color = "#4b5563")}
      >×</button>
    </div>
  );
}

export default function ChatWidget() {
  const [open, setOpen]           = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [mounted, setMounted]     = useState(false);
  const [messages, setMessages]   = useState<Message[]>([]);
  const [sessions, setSessions]   = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);
  useEffect(() => {
    if (open) {
      loadSessions();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  async function loadSessions() {
    try {
      const data = await apiGet<Session[]>("/chat/sessions");
      setSessions(data);
    } catch {}
  }

  async function loadHistory(sid: string) {
    setLoadingHistory(true);
    setSessionId(sid);
    setMessages([]);
    try {
      const data = await apiGet<Message[]>(`/chat/history/${sid}`);
      setMessages(data);
    } catch {
      setMessages([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  function newChat() {
    setSessionId(null);
    setMessages([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function deleteSession(sid: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await apiGet(`/chat/delete/${sid}`);
    } catch {}
    setSessions(prev => prev.filter(s => s.session_id !== sid));
    if (sessionId === sid) newChat();
  }

  async function sendMessage(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: msg }]);
    setLoading(true);
    try {
      const res = await apiPost<any>("/chat", { message: msg, session_id: sessionId });
      if (!sessionId) {
        setSessionId(res.session_id);
        await loadSessions();
      } else {
        setSessions(prev => prev.map(s =>
          s.session_id === sessionId
            ? { ...s, message_count: s.message_count + 2, updated_at: new Date().toISOString() }
            : s
        ));
      }
      setMessages(prev => [...prev, {
        role: "assistant", content: res.answer,
        cypher: res.cypher, type: res.type,
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Sorry, something went wrong. Please try again.",
      }]);
    } finally {
      setLoading(false);
    }
  }

  const user = getUser();

  if (!mounted) return null;

  return (
    <>
      {open && (
        <div style={{
          position: "fixed", bottom: 84, right: 24, zIndex: 1000,
          width: 700, height: 580,
          background: "#0f0f1a", border: "1px solid #2d2d4e",
          borderRadius: 16, display: "flex", overflow: "hidden",
          boxShadow: "0 24px 48px rgba(0,0,0,0.6)",
        }}>

          {/* Sidebar */}
          {showSidebar && (
            <div style={{
              width: 200, background: "#1a1a2e", borderRight: "1px solid #2d2d4e",
              display: "flex", flexDirection: "column", flexShrink: 0,
            }}>
              <div style={{ padding: "12px 10px", borderBottom: "1px solid #2d2d4e" }}>
                <button onClick={newChat} style={{
                  background: "#3b82f6", border: "none", borderRadius: 8,
                  padding: "7px 10px", color: "#fff", fontSize: 12,
                  fontWeight: 600, cursor: "pointer", width: "100%",
                }}>+ New Chat</button>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
                <p style={{ color: "#374151", fontSize: 10, fontWeight: 700, padding: "2px 6px", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  History
                </p>
                {sessions.length === 0 && (
                  <p style={{ color: "#374151", fontSize: 11, textAlign: "center", padding: "12px 6px" }}>
                    No conversations yet
                  </p>
                )}
                {sessions.map(s => (
                  <SessionItem
                    key={s.session_id}
                    session={s}
                    active={s.session_id === sessionId}
                    onClick={() => loadHistory(s.session_id)}
                    onDelete={(e) => deleteSession(s.session_id, e)}
                  />
                ))}
              </div>

              {user && (
                <div style={{
                  padding: "10px", borderTop: "1px solid #2d2d4e",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%",
                    background: "#3b82f622", border: "1px solid #3b82f644",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, color: "#3b82f6", fontWeight: 700, flexShrink: 0,
                  }}>
                    {user.username[0].toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {user.username}
                    </p>
                    <p style={{ color: "#4b5563", fontSize: 10, margin: 0 }}>{user.role}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Main chat area */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{
              padding: "12px 14px", background: "#1a1a2e", borderBottom: "1px solid #2d2d4e",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setShowSidebar(v => !v)} style={{
                  background: "none", border: "1px solid #2d2d4e", borderRadius: 6,
                  padding: "3px 7px", color: "#6b7280", cursor: "pointer", fontSize: 12,
                }}>☰</button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🤖</span>
                  <div>
                    <p style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 700, margin: 0 }}>Fraud Agent</p>
                    <p style={{ color: "#10b981", fontSize: 10, margin: 0 }}>● Online</p>
                  </div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} style={{
                background: "none", border: "none", color: "#6b7280",
                fontSize: 20, cursor: "pointer", lineHeight: 1,
              }}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
              {messages.length === 0 && !loadingHistory && (
                <div>
                  <p style={{ color: "#4b5563", fontSize: 12, textAlign: "center", marginBottom: 14 }}>
                    Ask me anything about your claims and fraud data.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {SUGGESTIONS.map(s => (
                      <button key={s} onClick={() => sendMessage(s)} style={{
                        background: "#1a1a2e", border: "1px solid #2d2d4e", borderRadius: 8,
                        padding: "8px 10px", color: "#94a3b8", fontSize: 11,
                        cursor: "pointer", textAlign: "left", lineHeight: 1.4,
                      }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#3b82f6"; (e.currentTarget as HTMLButtonElement).style.color = "#f1f5f9"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#2d2d4e"; (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}
                      >{s}</button>
                    ))}
                  </div>
                </div>
              )}

              {loadingHistory && (
                <p style={{ color: "#6b7280", fontSize: 12, textAlign: "center" }}>Loading conversation...</p>
              )}

              {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
              {loading && <TypingIndicator />}
              <div ref={bottomRef} />
            </div>

            <div style={{ padding: "10px 12px", borderTop: "1px solid #2d2d4e", background: "#1a1a2e", display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Ask about claims or fraud... (Enter to send)"
                rows={1}
                style={{
                  flex: 1, background: "#0f0f1a", border: "1px solid #2d2d4e",
                  borderRadius: 8, padding: "8px 12px", color: "#f1f5f9",
                  fontSize: 13, resize: "none", fontFamily: "inherit",
                  lineHeight: 1.5, outline: "none", maxHeight: 80, overflowY: "auto",
                }}
                onInput={e => {
                  const t = e.currentTarget;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 80) + "px";
                }}
                onFocus={e => (e.currentTarget.style.borderColor = "#3b82f6")}
                onBlur={e => (e.currentTarget.style.borderColor = "#2d2d4e")}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                style={{
                  background: input.trim() && !loading ? "#3b82f6" : "#2d2d4e",
                  border: "none", borderRadius: 8, padding: "8px 14px",
                  color: input.trim() && !loading ? "#fff" : "#4b5563",
                  fontSize: 14, fontWeight: 700,
                  cursor: input.trim() && !loading ? "pointer" : "not-allowed",
                  flexShrink: 0, transition: "background 0.15s",
                }}
              >{loading ? "..." : "↑"}</button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 1001,
          width: 52, height: 52, borderRadius: "50%",
          background: open ? "#2d2d4e" : "#3b82f6",
          border: `2px solid ${open ? "#3d3d5e" : "#2563eb"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, cursor: "pointer",
          boxShadow: "0 4px 20px rgba(59,130,246,0.4)",
          transition: "all 0.2s",
        }}
        onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.1)")}
        onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
        title="Fraud Investigation Agent"
      >
        {open ? "×" : "🤖"}
      </button>
    </>
  );
}
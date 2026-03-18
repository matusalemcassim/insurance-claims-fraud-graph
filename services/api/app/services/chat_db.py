"""
SQLite-based chat history storage.
Stores sessions and messages with in-memory cache for active sessions.
Supports both global sessions and claim-scoped sessions.
"""
from __future__ import annotations
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = str(Path(__file__).parent.parent / "chat_history.db")

_memory: dict[str, list[dict]] = {}


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL,
                claim_id   TEXT DEFAULT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                message_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role       TEXT NOT NULL,
                content    TEXT NOT NULL,
                cypher     TEXT,
                results    TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)")

        # Migrate existing DB — add claim_id column if it doesn't exist yet
        try:
            conn.execute("ALTER TABLE sessions ADD COLUMN claim_id TEXT DEFAULT NULL")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_claim ON sessions(claim_id)")
        except Exception:
            pass  # column already exists

        conn.commit()
    print("Chat DB initialized at", DB_PATH)


def get_or_create_session(
    user_id: str,
    session_id: str | None = None,
    claim_id:   str | None = None,
) -> str:
    """
    Get or create a session.
    - For claim-scoped sessions, uses deterministic ID: {user_id}-claim-{claim_id}
    - For global sessions, generates or reuses provided session_id
    """
    now = datetime.now(timezone.utc).isoformat()

    # Deterministic session ID for claim-scoped chats
    if claim_id and not session_id:
        session_id = f"{user_id}-claim-{claim_id}"

    if not session_id:
        session_id = f"SESS-{uuid.uuid4().hex[:12].upper()}"

    with _conn() as conn:
        existing = conn.execute(
            "SELECT session_id FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO sessions (session_id, user_id, claim_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (session_id, user_id, claim_id, now, now)
            )
            conn.commit()
    return session_id


def save_message(
    session_id: str,
    role:       str,
    content:    str,
    cypher:     str = None,
    results:    str = None,
) -> dict:
    message_id = f"MSG-{uuid.uuid4().hex[:10].upper()}"
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        conn.execute(
            "INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)",
            (message_id, session_id, role, content, cypher, results, now)
        )
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
            (now, session_id)
        )
        conn.commit()
    msg = {
        "role": role, "content": content,
        "cypher": cypher, "results": results, "created_at": now,
    }
    if session_id not in _memory:
        _memory[session_id] = []
    _memory[session_id].append(msg)
    return msg


def get_session_messages(session_id: str, limit: int = 50) -> list[dict]:
    if session_id in _memory:
        return _memory[session_id][-limit:]
    with _conn() as conn:
        rows = conn.execute("""
            SELECT role, content, cypher, results, created_at
            FROM messages WHERE session_id = ?
            ORDER BY created_at ASC LIMIT ?
        """, (session_id, limit)).fetchall()
    msgs = [dict(r) for r in rows]
    _memory[session_id] = msgs
    return msgs


def get_claim_session_messages(user_id: str, claim_id: str, limit: int = 50) -> list[dict]:
    """Fetch history for a specific claim chat session."""
    session_id = f"{user_id}-claim-{claim_id}"
    return get_session_messages(session_id, limit)


def get_user_sessions(user_id: str, limit: int = 20) -> list[dict]:
    """Return global (non-claim) sessions for a user."""
    with _conn() as conn:
        rows = conn.execute("""
            SELECT s.session_id, s.created_at, s.updated_at, s.claim_id,
                   COUNT(m.message_id) as message_count,
                   (
                       SELECT content FROM messages
                       WHERE session_id = s.session_id AND role = 'user'
                       ORDER BY created_at ASC LIMIT 1
                   ) as last_message
            FROM sessions s
            LEFT JOIN messages m ON s.session_id = m.session_id
            WHERE s.user_id = ? AND s.claim_id IS NULL
            GROUP BY s.session_id
            ORDER BY s.updated_at DESC LIMIT ?
        """, (user_id, limit)).fetchall()
    return [dict(r) for r in rows]


def delete_session(session_id: str):
    with _conn() as conn:
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        conn.commit()
    _memory.pop(session_id, None)
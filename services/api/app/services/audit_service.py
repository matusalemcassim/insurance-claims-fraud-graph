from __future__ import annotations
import uuid
from datetime import datetime, timezone
from app.db.neo4j import get_driver

def _now():
    return datetime.now(timezone.utc).isoformat()

def log_action(user_id: str, action: str, resource_id: str = None, resource_type: str = None, details: str = ""):
    driver = get_driver()
    log_id = f"LOG-{uuid.uuid4().hex[:8].upper()}"
    now = _now()
    with driver.session() as s:
        s.run("""
            MERGE (u:User {user_id: $user_id})
            CREATE (l:AuditLog {
                log_id: $log_id, action: $action,
                user_id: $user_id, resource_id: $resource_id,
                resource_type: $resource_type, details: $details,
                timestamp: $now
            })
            CREATE (u)-[:PERFORMED]->(l)
        """, log_id=log_id, action=action, user_id=user_id,
             resource_id=resource_id or "", resource_type=resource_type or "",
             details=details, now=now)
    return log_id

def get_audit_logs(user_id: str = None, resource_id: str = None, limit: int = 50) -> list[dict]:
    driver = get_driver()
    if user_id:
        query = "MATCH (u:User {user_id: $user_id})-[:PERFORMED]->(l:AuditLog) RETURN l ORDER BY l.timestamp DESC LIMIT $limit"
        params = {"user_id": user_id, "limit": limit}
    elif resource_id:
        query = "MATCH (l:AuditLog {resource_id: $resource_id}) RETURN l ORDER BY l.timestamp DESC LIMIT $limit"
        params = {"resource_id": resource_id, "limit": limit}
    else:
        query = "MATCH (l:AuditLog) RETURN l ORDER BY l.timestamp DESC LIMIT $limit"
        params = {"limit": limit}
    with driver.session() as s:
        results = s.run(query, **params).data()
    return [dict(r["l"]) for r in results]
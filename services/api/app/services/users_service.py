from __future__ import annotations
import uuid
from datetime import datetime, timezone
from app.db.neo4j import get_driver
from app.services.auth_service import hash_password, verify_password

def _now():
    return datetime.now(timezone.utc).isoformat()

ROLES = {"admin", "manager", "investigator"}

def create_user(username, password, role):
    if role not in ROLES:
        return None
    driver = get_driver()
    user_id = f"USR-{uuid.uuid4().hex[:8].upper()}"
    now = _now()
    with driver.session() as s:
        existing = s.run("MATCH (u:User {username: $username}) RETURN u.user_id AS uid", username=username).single()
        if existing:
            return {"error": "username_taken"}
        result = s.run("""
            CREATE (u:User {
                user_id: $user_id, username: $username,
                password_hash: $password_hash, role: $role,
                is_active: true, created_at: $now
            }) RETURN u
        """, user_id=user_id, username=username, password_hash=hash_password(password), role=role, now=now).single()
        return _format_user(dict(result["u"]))

def get_user_by_username(username):
    driver = get_driver()
    with driver.session() as s:
        result = s.run("MATCH (u:User {username: $username}) RETURN u", username=username).single()
        if not result:
            return None
        return _format_user(dict(result["u"]), include_hash=True)

def get_user_by_id(user_id):
    driver = get_driver()
    with driver.session() as s:
        result = s.run("MATCH (u:User {user_id: $user_id}) RETURN u", user_id=user_id).single()
        if not result:
            return None
        return _format_user(dict(result["u"]))

def list_users():
    driver = get_driver()
    with driver.session() as s:
        results = s.run("MATCH (u:User) RETURN u ORDER BY u.created_at DESC").data()
    return [_format_user(dict(r["u"])) for r in results]

def authenticate_user(username, password):
    user = get_user_by_username(username)
    if not user or not user.get("is_active"):
        return None
    if not verify_password(password, user.get("password_hash", "")):
        return None
    return _format_user(user)

def set_user_active(user_id, is_active):
    driver = get_driver()
    with driver.session() as s:
        result = s.run("MATCH (u:User {user_id: $user_id}) SET u.is_active = $is_active RETURN u", user_id=user_id, is_active=is_active).single()
        if not result:
            return None
        return _format_user(dict(result["u"]))

def seed_default_users():
    driver = get_driver()
    with driver.session() as s:
        count = s.run("MATCH (u:User) RETURN count(u) AS c").single()["c"]
        if count > 0:
            return
    for username, password, role in [("admin","admin123","admin"),("manager","manager123","manager"),("investigator","investigator123","investigator")]:
        create_user(username, password, role)
    print("Seeded default users: admin / manager / investigator")

def _format_user(props, include_hash=False):
    out = {"user_id": props.get("user_id"), "username": props.get("username"), "role": props.get("role"), "is_active": props.get("is_active", True), "created_at": str(props.get("created_at", ""))}
    if include_hash:
        out["password_hash"] = props.get("password_hash", "")
    return out
"""
JWT authentication service.
Handles token creation, validation, and password hashing.
"""
from __future__ import annotations
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
import bcrypt

SECRET_KEY  = os.getenv("JWT_SECRET_KEY", "f6e47610de97468f273fc27345aec54aa7bce55e797f010c5318c483f498f09d")
ALGORITHM   = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES  = 15
REFRESH_TOKEN_EXPIRE_DAYS    = 7


# ---------------------------------------------------------------------------
# PASSWORD
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ---------------------------------------------------------------------------
# TOKENS
# ---------------------------------------------------------------------------

def create_access_token(user_id: str, username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub":      user_id,
        "username": username,
        "role":     role,
        "type":     "access",
        "exp":      expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub":  user_id,
        "type": "refresh",
        "exp":  expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def decode_access_token(token: str) -> dict | None:
    payload = decode_token(token)
    if payload and payload.get("type") == "access":
        return payload
    return None


def decode_refresh_token(token: str) -> str | None:
    payload = decode_token(token)
    if payload and payload.get("type") == "refresh":
        return payload.get("sub")
    return None
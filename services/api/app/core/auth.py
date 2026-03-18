"""
Core auth dependencies for FastAPI routes.
Replaces static API key check with JWT + role-based access control.
"""
from __future__ import annotations
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, APIKeyHeader
from app.services.auth_service import decode_access_token
import os

bearer        = HTTPBearer(auto_error=False)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

STATIC_API_KEY = os.getenv("API_KEY", "")


def _get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    api_key: str = Depends(api_key_header),
) -> dict:
    # Support legacy static API key for backwards compatibility
    if api_key and api_key == STATIC_API_KEY:
        return {"user_id": "system", "username": "system", "role": "admin"}

    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    return {
        "user_id":  payload["sub"],
        "username": payload["username"],
        "role":     payload["role"],
    }


def require_api_key(user: dict = Depends(_get_current_user)) -> dict:
    """Basic auth — any authenticated user."""
    return user


def require_investigator(user: dict = Depends(_get_current_user)) -> dict:
    if user["role"] not in ("investigator", "manager", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Investigator role required")
    return user


def require_manager(user: dict = Depends(_get_current_user)) -> dict:
    if user["role"] not in ("manager", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager role required")
    return user


def require_admin(user: dict = Depends(_get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user
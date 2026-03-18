from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from app.services.auth_service import create_access_token, create_refresh_token, decode_refresh_token, decode_access_token
from app.services.users_service import authenticate_user, get_user_by_id

router = APIRouter(prefix="/auth", tags=["auth"])
bearer = HTTPBearer()

class LoginRequest(BaseModel):
    username: str
    password: str

class RefreshRequest(BaseModel):
    refresh_token: str

@router.post("/login")
def login(body: LoginRequest):
    user = authenticate_user(body.username, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    access_token  = create_access_token(user["user_id"], user["username"], user["role"])
    refresh_token = create_refresh_token(user["user_id"])
    return {
        "access_token":  access_token,
        "refresh_token": refresh_token,
        "token_type":    "bearer",
        "user": {
            "user_id":  user["user_id"],
            "username": user["username"],
            "role":     user["role"],
        }
    }

@router.post("/refresh")
def refresh(body: RefreshRequest):
    user_id = decode_refresh_token(body.refresh_token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    user = get_user_by_id(user_id)
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    access_token = create_access_token(user["user_id"], user["username"], user["role"])
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me")
def me(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = get_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user
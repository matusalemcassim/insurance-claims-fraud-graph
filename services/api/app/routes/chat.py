from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from app.core.auth import require_api_key
from app.services.chat_db import (
    get_or_create_session, save_message,
    get_session_messages, get_user_sessions,
    get_claim_session_messages, delete_session,
)
from app.services.chat_agent import run_agent

router = APIRouter(prefix="/chat", tags=["chat"])


class ClaimContextRequest(BaseModel):
    claim_id:       str
    claim_type:     Optional[str]   = None
    claim_amount:   Optional[float] = None
    status:         Optional[str]   = None
    fraud_scenario: Optional[str]   = None
    label_is_fraud: Optional[int]   = None


class ChatRequest(BaseModel):
    message:       str
    session_id:    Optional[str]                 = None
    claim_context: Optional[ClaimContextRequest] = None


@router.post("")
def chat(body: ChatRequest, current_user: dict = Depends(require_api_key)):
    user_id   = current_user["user_id"]
    claim_ctx = body.claim_context.dict() if body.claim_context else None
    claim_id  = claim_ctx.get("claim_id") if claim_ctx else None

    # Claim sessions use deterministic ID; global sessions use provided or new ID
    session_id = get_or_create_session(
        user_id,
        session_id=body.session_id,
        claim_id=claim_id,
    )

    history = get_session_messages(session_id)

    save_message(session_id, "user", body.message)

    result = run_agent(body.message, history, claim_context=claim_ctx)

    save_message(
        session_id, "assistant",
        result["answer"],
        cypher=result.get("cypher"),
        results=result.get("results"),
    )

    return {
        "session_id": session_id,
        "type":       result["type"],
        "answer":     result["answer"],
        "cypher":     result.get("cypher"),
        "results":    result.get("results"),
    }


@router.get("/claim/{claim_id}/history")
def get_claim_history(claim_id: str, current_user: dict = Depends(require_api_key)):
    """Return full chat history for a specific claim."""
    msgs = get_claim_session_messages(current_user["user_id"], claim_id)
    return {"claim_id": claim_id, "messages": msgs}


@router.get("/sessions")
def list_sessions(current_user: dict = Depends(require_api_key)):
    return get_user_sessions(current_user["user_id"])


@router.get("/history/{session_id}")
def get_history(session_id: str, current_user: dict = Depends(require_api_key)):
    return get_session_messages(session_id)


@router.delete("/{session_id}")
def clear_session(session_id: str, current_user: dict = Depends(require_api_key)):
    delete_session(session_id)
    return {"deleted": True, "session_id": session_id}


@router.get("/delete/{session_id}")
def delete_session_route(session_id: str, current_user: dict = Depends(require_api_key)):
    delete_session(session_id)
    return {"deleted": True, "session_id": session_id}
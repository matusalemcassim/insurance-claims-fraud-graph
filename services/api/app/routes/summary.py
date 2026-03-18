from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import require_api_key
from app.services.summarization import generate_claim_summary

router = APIRouter(prefix="/summary", tags=["summary"])


@router.get("/claim/{claim_id}")
def claim_summary(claim_id: str, _: str = Depends(require_api_key)):
    """
    Generate a natural language investigator briefing for a claim using Claude.
    This call hits the Anthropic API and may take 2-5 seconds.
    """
    result = generate_claim_summary(claim_id)
    if not result:
        raise HTTPException(status_code=404, detail="Claim not found")
    return result
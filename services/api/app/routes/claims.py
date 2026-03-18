from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import require_api_key
from app.services.claims import get_claim, get_flagged_claims

router = APIRouter()


@router.get("/claims", dependencies=[Depends(require_api_key)])
def list_flagged_claims(limit: int = 200):
    return get_flagged_claims(limit=limit)


@router.get("/claims/{claim_id}", dependencies=[Depends(require_api_key)])
def read_claim(claim_id: str):
    data = get_claim(claim_id)
    if not data:
        raise HTTPException(status_code=404, detail="Claim not found")
    return data
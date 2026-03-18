from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import require_api_key
from app.services.scoring import get_claim_risk_score

router = APIRouter(prefix="/scoring", tags=["scoring"])


@router.get("/claim/{claim_id}")
def claim_risk_score(claim_id: str, _: str = Depends(require_api_key)):
    result = get_claim_risk_score(claim_id)
    if not result:
        raise HTTPException(status_code=404, detail="Claim not found")
    return result
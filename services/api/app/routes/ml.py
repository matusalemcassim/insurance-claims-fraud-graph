from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import require_api_key
from app.services.ml_scoring import get_ml_score

router = APIRouter(prefix="/ml", tags=["ml"])


@router.get("/score/{claim_id}")
def ml_claim_score(claim_id: str, _: str = Depends(require_api_key)):
    """
    Return XGBoost ML fraud probability score for a claim.
    Model must be trained first via scripts/train_model.py.
    """
    try:
        result = get_ml_score(claim_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if not result:
        raise HTTPException(status_code=404, detail="Claim not found")
    return result
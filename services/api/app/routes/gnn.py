from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import require_api_key
from app.services.gnn_scoring import get_gnn_score

router = APIRouter(prefix="/gnn", tags=["gnn"])


@router.get("/score/{claim_id}")
def gnn_claim_score(claim_id: str, _: str = Depends(require_api_key)):
    """
    Return GraphSAGE GNN fraud probability score for a claim.
    Model must be trained first via scripts/train_gnn.py.
    """
    try:
        result = get_gnn_score(claim_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if not result:
        raise HTTPException(status_code=404, detail="Claim not found")
    return result
from fastapi import APIRouter, Depends
from app.core.auth import require_api_key
from app.services.graph import get_neighborhood

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("/neighborhood")
def neighborhood(
    node_id: str,
    node_label: str = "Claim",
    depth: int = 2,
    _: str = Depends(require_api_key),
):
    return get_neighborhood(node_id, node_label, depth)
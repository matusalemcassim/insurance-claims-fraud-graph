from fastapi import APIRouter, Depends
from app.core.auth import require_api_key
from app.services.patterns import detect_all_patterns

router = APIRouter(prefix="/patterns", tags=["patterns"])


@router.get("")
def get_patterns(_: str = Depends(require_api_key)):
    """
    Run all fraud pattern detectors across the full graph and return results.
    This may take a few seconds on large datasets.
    """
    return detect_all_patterns()
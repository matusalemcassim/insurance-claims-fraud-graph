from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.core.auth import require_api_key
from app.services.cases import (
    create_case, get_case, list_cases,
    update_case, delete_case, get_case_for_claim,
)

router = APIRouter(prefix="/cases", tags=["cases"])


class CreateCaseRequest(BaseModel):
    claim_id:    str
    assigned_to: str
    priority:    Optional[str] = "MEDIUM"


class UpdateCaseRequest(BaseModel):
    status:      Optional[str] = None
    notes:       Optional[str] = None
    assigned_to: Optional[str] = None
    decision:    Optional[str] = None
    priority:    Optional[str] = None


@router.post("")
def open_case(body: CreateCaseRequest, _: str = Depends(require_api_key)):
    result = create_case(body.claim_id, body.assigned_to, body.priority or "MEDIUM")
    if result is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if "error" in result and result["error"] == "open_case_exists":
        raise HTTPException(status_code=409, detail=f"Open case already exists: {result['case_id']}")
    return result

@router.get("")
def list_all_cases(
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    current_user: dict = Depends(require_api_key),
):
    # Investigators can only see their own cases
    if current_user["role"] == "investigator":
        assigned_to = current_user["username"]
    return list_cases(status=status, assigned_to=assigned_to)


@router.get("/claim/{claim_id}")
def case_for_claim(claim_id: str, _: str = Depends(require_api_key)):
    result = get_case_for_claim(claim_id)
    if not result:
        raise HTTPException(status_code=404, detail="No case found for this claim")
    return result


@router.get("/{case_id}")
def get_single_case(case_id: str, _: str = Depends(require_api_key)):
    result = get_case(case_id)
    if not result:
        raise HTTPException(status_code=404, detail="Case not found")
    return result


@router.patch("/{case_id}")
def update_single_case(
    case_id: str,
    body: UpdateCaseRequest,
    _: str = Depends(require_api_key),
):
    result = update_case(case_id, body.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(status_code=404, detail="Case not found")
    return result


@router.delete("/{case_id}")
def remove_case(case_id: str, _: str = Depends(require_api_key)):
    success = delete_case(case_id)
    if not success:
        raise HTTPException(status_code=404, detail="Case not found")
    return {"deleted": True, "case_id": case_id}
"""
FastAPI routes for document upload and extraction.
"""
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from app.core.auth import require_api_key
from app.services.document_store import save_file, delete_file
from app.services.document_agent import extract_document, get_claim_documents

router = APIRouter(prefix="/claims", tags=["documents"])

ALLOWED_TYPES = {
    "application/pdf":  "PDF",
    "image/jpeg":       "JPG",
    "image/jpg":        "JPG",
    "image/png":        "PNG",
    "image/webp":       "WEBP",
    "text/plain":       "TXT",
}

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


@router.post("/{claim_id}/documents")
async def upload_document(
    claim_id:     str,
    file:         UploadFile = File(...),
    current_user: dict = Depends(require_api_key),
):
    # Validate file type
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. "
                   f"Allowed: PDF, JPG, PNG, WEBP, TXT"
        )

    # Read content
    content = await file.read()

    # Validate file size
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail="File too large. Maximum size is 10MB."
        )

    # Save to filesystem
    file_meta = save_file(claim_id, file.filename or "upload", content)
    file_type = ALLOWED_TYPES[file.content_type]

    # Run extraction pipeline
    result = extract_document(
        claim_id=claim_id,
        doc_id=file_meta["document_id"],
        file_path=file_meta["file_path"],
        file_type=file_type,
        file_name=file_meta["file_name"],
    )

    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result["message"])

    return {
        **file_meta,
        "extraction": result,
    }


@router.get("/{claim_id}/documents")
def list_documents(
    claim_id:     str,
    current_user: dict = Depends(require_api_key),
):
    return get_claim_documents(claim_id)


@router.delete("/{claim_id}/documents/{document_id}")
def remove_document(
    claim_id:     str,
    document_id:  str,
    current_user: dict = Depends(require_api_key),
):
    from app.db.neo4j import get_driver
    driver = get_driver()
    with driver.session() as session:
        result = session.run("""
            MATCH (d:Document {document_id: $doc_id, claim_id: $claim_id})
            RETURN d.file_path AS file_path
        """, doc_id=document_id, claim_id=claim_id).single()

        if not result:
            raise HTTPException(status_code=404, detail="Document not found")

        file_path = result["file_path"]
        session.run("""
            MATCH (d:Document {document_id: $doc_id})
            DETACH DELETE d
        """, doc_id=document_id)

    delete_file(file_path)
    return {"deleted": True, "document_id": document_id}

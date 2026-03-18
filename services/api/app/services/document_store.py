"""
File system operations for uploaded claim documents.
Stores files in services/api/uploads/{claim_id}/
"""
from __future__ import annotations
import os
import uuid
import shutil
from pathlib import Path
from datetime import datetime, timezone

# Base upload directory — relative to where uvicorn runs (services/api/)
UPLOAD_BASE = Path("uploads")


def _claim_dir(claim_id: str) -> Path:
    d = UPLOAD_BASE / claim_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_file(claim_id: str, filename: str, content: bytes) -> dict:
    """Save uploaded file and return metadata."""
    ext        = Path(filename).suffix.lower()
    doc_id     = f"DOC-{uuid.uuid4().hex[:10].upper()}"
    safe_name  = f"{doc_id}{ext}"
    dest       = _claim_dir(claim_id) / safe_name

    dest.write_bytes(content)

    return {
        "document_id": doc_id,
        "claim_id":    claim_id,
        "file_name":   filename,
        "file_path":   str(dest),
        "file_type":   ext.lstrip(".").upper(),
        "file_size":   len(content),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }


def read_file(file_path: str) -> bytes:
    return Path(file_path).read_bytes()


def delete_file(file_path: str) -> bool:
    p = Path(file_path)
    if p.exists():
        p.unlink()
        return True
    return False


def list_claim_files(claim_id: str) -> list[str]:
    d = _claim_dir(claim_id)
    return [str(f) for f in d.iterdir() if f.is_file()]
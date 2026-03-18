"""
Claude-powered document extraction agent.
Pipeline:
  1. LlamaParse REST API  — premium PDF/image parsing (no SDK, direct HTTP)
  2. Claude               — classify document type
  3. Claude               — extract using Pydantic schema for that type
  4. Neo4j                — reconcile with existing graph nodes
  5. Neo4j                — store Document node + relationships
"""
from __future__ import annotations
import os
import json
import base64
import time
from pathlib import Path
from typing import Optional

import httpx
import anthropic
from pydantic import BaseModel, Field

from app.db.neo4j import get_driver

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

LLAMA_CLOUD_API_KEY = os.getenv("LLAMA_CLOUD_API_KEY", "")
LLAMA_PARSE_URL     = "https://api.cloud.llamaindex.ai/api/parsing"

# ---------------------------------------------------------------------------
# Pydantic schemas — one per document type
# ---------------------------------------------------------------------------
class FinancialAmount(BaseModel):
    description: str            = Field(description="What this amount refers to")
    value:       float          = Field(description="Numeric value in USD")

class DateEntry(BaseModel):
    description: str = Field(description="What this date refers to")
    value:       str = Field(description="Date in YYYY-MM-DD format if possible")

class PersonEntry(BaseModel):
    role:    str           = Field(description="claimant|witness|doctor|officer|attorney")
    name:    Optional[str] = None
    address: Optional[str] = None
    phone:   Optional[str] = None

class VehicleInfo(BaseModel):
    vin:                   Optional[str]   = None
    make:                  Optional[str]   = None
    model:                 Optional[str]   = None
    year:                  Optional[int]   = None
    license_plate:         Optional[str]   = None
    damage_description:    Optional[str]   = None
    estimated_repair_cost: Optional[float] = None

class ProviderInfo(BaseModel):
    name:           Optional[str]   = None
    address:        Optional[str]   = None
    phone:          Optional[str]   = None
    license_number: Optional[str]   = None
    specialty:      Optional[str]   = None
    total_billed:   Optional[float] = None

# --- Per-type extraction schemas ---

class PoliceReportExtraction(BaseModel):
    incident_date:        Optional[str]        = None
    incident_location:    Optional[str]        = None
    report_number:        Optional[str]        = None
    officers:             list[PersonEntry]    = []
    parties_involved:     list[PersonEntry]    = []
    vehicle:              Optional[VehicleInfo] = None
    incident_description: Optional[str]        = None
    citations_issued:     list[str]            = []
    fraud_signals:        list[str]            = []
    summary:              str                  = ""
    confidence:           str                  = "high"

class RepairEstimateExtraction(BaseModel):
    shop_info:        Optional[ProviderInfo] = None
    vehicle:          Optional[VehicleInfo]  = None
    line_items:       list[FinancialAmount]  = []
    subtotal:         Optional[float]        = None
    tax:              Optional[float]        = None
    total:            Optional[float]        = None
    estimate_date:    Optional[str]          = None
    completion_date:  Optional[str]          = None
    fraud_signals:    list[str]              = []
    summary:          str                    = ""
    confidence:       str                    = "high"

class MedicalRecordExtraction(BaseModel):
    provider:      Optional[ProviderInfo] = None
    patient:       Optional[PersonEntry]  = None
    diagnosis:     Optional[str]          = None
    treatment:     Optional[str]          = None
    dates:         list[DateEntry]        = []
    amounts:       list[FinancialAmount]  = []
    icd_codes:     list[str]             = []
    fraud_signals: list[str]             = []
    summary:       str                   = ""
    confidence:    str                   = "high"

class ClaimFormExtraction(BaseModel):
    claimant:             Optional[PersonEntry]  = None
    incident_date:        Optional[str]          = None
    incident_description: Optional[str]          = None
    claimed_amount:       Optional[float]        = None
    policy_number:        Optional[str]          = None
    supporting_docs:      list[str]              = []
    vehicle:              Optional[VehicleInfo]  = None
    fraud_signals:        list[str]              = []
    summary:              str                    = ""
    confidence:           str                    = "high"

class InvoiceExtraction(BaseModel):
    vendor:         Optional[ProviderInfo] = None
    invoice_number: Optional[str]          = None
    invoice_date:   Optional[str]          = None
    line_items:     list[FinancialAmount]  = []
    subtotal:       Optional[float]        = None
    tax:            Optional[float]        = None
    total:          Optional[float]        = None
    fraud_signals:  list[str]             = []
    summary:        str                   = ""
    confidence:     str                   = "high"

class GenericExtraction(BaseModel):
    people:        list[PersonEntry]      = []
    amounts:       list[FinancialAmount]  = []
    dates:         list[DateEntry]        = []
    vehicle:       Optional[VehicleInfo]  = None
    provider:      Optional[ProviderInfo] = None
    fraud_signals: list[str]             = []
    summary:       str                   = ""
    confidence:    str                   = "high"

SCHEMA_MAP = {
    "police_report":   PoliceReportExtraction,
    "repair_estimate": RepairEstimateExtraction,
    "medical_record":  MedicalRecordExtraction,
    "claim_form":      ClaimFormExtraction,
    "invoice":         InvoiceExtraction,
    "other":           GenericExtraction,
}

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------
CLASSIFY_PROMPT = """You are an insurance fraud investigator.
Classify this document into exactly one of these types:
- police_report
- repair_estimate
- medical_record
- claim_form
- invoice
- other

Reply with ONLY the type string, nothing else."""

def _extraction_prompt(doc_type: str, schema_json: str) -> str:
    return f"""You are an expert insurance fraud investigator analyzing a {doc_type.replace('_', ' ')}.

Extract ALL relevant information and return ONLY valid JSON matching this exact schema:
{schema_json}

Rules:
- Use null for any field not found in the document
- For fraud_signals, list specific red flags you observe
  (e.g. "repair total $45,000 seems inflated for described damage",
        "provider license number missing",
        "incident date inconsistent with filing date")
- For confidence: high = clear readable document, medium = some ambiguity, low = poor quality or suspicious
- Be thorough — missing or inconsistent information is itself a fraud signal
- Return ONLY the JSON object, no markdown, no backticks"""

# ---------------------------------------------------------------------------
# LlamaParse — direct REST API (no SDK, Python 3.14 compatible)
# ---------------------------------------------------------------------------
def _parse_with_llama(file_path: str, file_type: str) -> str:
    """Call LlamaParse REST API directly."""
    if not LLAMA_CLOUD_API_KEY:
        return ""

    mime_map = {
        "PDF":  "application/pdf",
        "JPG":  "image/jpeg",
        "JPEG": "image/jpeg",
        "PNG":  "image/png",
        "WEBP": "image/webp",
        "TXT":  "text/plain",
    }
    mime    = mime_map.get(file_type.upper(), "application/octet-stream")
    headers = {"Authorization": f"Bearer {LLAMA_CLOUD_API_KEY}"}

    try:
        # Step 1: Upload file
        with open(file_path, "rb") as f:
            upload_resp = httpx.post(
                f"{LLAMA_PARSE_URL}/upload",
                headers=headers,
                files={"file": (Path(file_path).name, f, mime)},
                data={"result_type": "markdown"},
                timeout=60,
            )
        upload_resp.raise_for_status()
        job_id = upload_resp.json()["id"]
        print(f"[DocumentAgent] LlamaParse job started: {job_id}")

        # Step 2: Poll for completion (max 60s)
        for _ in range(30):
            time.sleep(2)
            status_resp = httpx.get(
                f"{LLAMA_PARSE_URL}/job/{job_id}",
                headers=headers,
                timeout=30,
            )
            status_resp.raise_for_status()
            status = status_resp.json().get("status", "")
            if status == "SUCCESS":
                break
            elif status in ("ERROR", "CANCELLED"):
                print(f"[DocumentAgent] LlamaParse job failed: {status}")
                return ""

        # Step 3: Fetch markdown result
        result_resp = httpx.get(
            f"{LLAMA_PARSE_URL}/job/{job_id}/result/markdown",
            headers=headers,
            timeout=30,
        )
        result_resp.raise_for_status()
        text = result_resp.json().get("markdown", "")
        print(f"[DocumentAgent] LlamaParse success — {len(text)} chars extracted")
        return text

    except Exception as e:
        print(f"[DocumentAgent] LlamaParse failed: {e} — falling back to Claude native")
        return ""


def _build_claude_content(file_path: str, file_type: str, parsed_text: str) -> list:
    """Build Claude message content — use parsed text if available, else send raw file."""
    ft = file_type.upper()

    if parsed_text.strip():
        return [{"type": "text", "text": f"Document content:\n\n{parsed_text}"}]

    # No parsed text — send raw file to Claude
    content = Path(file_path).read_bytes()
    b64     = base64.standard_b64encode(content).decode("utf-8")

    if ft == "PDF":
        return [{
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
        }]
    elif ft in ("JPG", "JPEG", "PNG", "WEBP"):
        media_map = {
            "JPG": "image/jpeg", "JPEG": "image/jpeg",
            "PNG": "image/png",  "WEBP": "image/webp",
        }
        return [{
            "type": "image",
            "source": {"type": "base64", "media_type": media_map.get(ft, "image/jpeg"), "data": b64},
        }]
    else:
        text = content.decode("utf-8", errors="replace")
        return [{"type": "text", "text": f"Document content:\n\n{text}"}]


# ---------------------------------------------------------------------------
# Step 1: Classify
# ---------------------------------------------------------------------------
def _classify_document(content: list) -> str:
    try:
        response = claude.messages.create(
            model="claude-opus-4-5",
            max_tokens=20,
            messages=[{
                "role": "user",
                "content": content + [{"type": "text", "text": CLASSIFY_PROMPT}],
            }],
        )
        doc_type = response.content[0].text.strip().lower().replace(" ", "_")
        return doc_type if doc_type in SCHEMA_MAP else "other"
    except Exception as e:
        print(f"[DocumentAgent] Classification failed: {e}")
        return "other"


# ---------------------------------------------------------------------------
# Step 2: Extract with type-specific Pydantic schema
# ---------------------------------------------------------------------------
def _extract_with_schema(content: list, doc_type: str) -> dict:
    schema_cls  = SCHEMA_MAP.get(doc_type, GenericExtraction)
    schema_json = json.dumps(schema_cls.model_json_schema(), indent=2)
    prompt      = _extraction_prompt(doc_type, schema_json)

    try:
        response = claude.messages.create(
            model="claude-opus-4-5",
            max_tokens=2000,
            messages=[{
                "role": "user",
                "content": content + [{"type": "text", "text": prompt}],
            }],
        )
        raw = response.content[0].text.strip()

        # Strip fences
        if raw.startswith("```"):
            parts = raw.split("```")
            raw   = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        parsed    = json.loads(raw)
        validated = schema_cls(**parsed)
        return validated.model_dump()

    except Exception as e:
        print(f"[DocumentAgent] Extraction failed: {e}")
        return GenericExtraction(
            summary="Extraction encountered an error. Document may be unreadable.",
            confidence="low",
            fraud_signals=["extraction_failed"],
        ).model_dump()


# ---------------------------------------------------------------------------
# Neo4j reconciliation
# ---------------------------------------------------------------------------
def _reconcile_with_graph(claim_id: str, doc_id: str, doc_type: str, extracted: dict) -> dict:
    driver = get_driver()
    report = {
        "updated_nodes":  [],
        "created_nodes":  [],
        "contradictions": [],
        "fraud_signals":  list(extracted.get("fraud_signals", [])),
    }

    with driver.session() as session:
        claim_result = session.run("""
            MATCH (c:Claim {claim_id: $claim_id})
            OPTIONAL MATCH (c)-[:INVOLVES_VEHICLE]->(v:Vehicle)
            RETURN c, v
        """, claim_id=claim_id).single()

        if not claim_result:
            return report

        claim_node = dict(claim_result["c"])

        # --- Financial contradiction detection ---
        all_amounts = []
        if doc_type == "repair_estimate" and extracted.get("total"):
            all_amounts.append(("repair total", extracted["total"]))
        elif doc_type == "invoice" and extracted.get("total"):
            all_amounts.append(("invoice total", extracted["total"]))
        elif doc_type == "medical_record":
            for amt in extracted.get("amounts", []):
                if isinstance(amt, dict) and amt.get("value"):
                    all_amounts.append((amt.get("description", "medical amount"), amt["value"]))
        elif doc_type == "claim_form" and extracted.get("claimed_amount"):
            all_amounts.append(("claimed amount", extracted["claimed_amount"]))

        for desc, val in all_amounts:
            if val and claim_node.get("claim_amount"):
                existing = float(claim_node["claim_amount"])
                if existing > 0 and abs(val - existing) / existing > 0.25:
                    report["contradictions"].append(
                        f"Amount mismatch: document {desc} is ${val:,.2f} "
                        f"but claim records ${existing:,.2f}"
                    )
                    report["fraud_signals"].append("amount_mismatch")

        # --- Vehicle reconciliation ---
        vehicle_data = extracted.get("vehicle") or {}
        if isinstance(vehicle_data, dict) and any(vehicle_data.get(k) for k in ("vin", "make", "model")):
            existing_v = claim_result["v"]
            if existing_v:
                ev = dict(existing_v)
                if vehicle_data.get("vin") and ev.get("vin") and vehicle_data["vin"] != ev["vin"]:
                    report["contradictions"].append(
                        f"VIN mismatch: document has {vehicle_data['vin']} "
                        f"but claim has {ev.get('vin')}"
                    )
                    report["fraud_signals"].append("vin_mismatch")
                updates = {k: v for k, v in vehicle_data.items()
                           if v and not ev.get(k)}
                if updates:
                    set_clause = ", ".join(f"v.{k} = ${k}" for k in updates)
                    session.run(
                        f"MATCH (v:Vehicle)<-[:INVOLVES_VEHICLE]-(:Claim {{claim_id: $claim_id}}) "
                        f"SET {set_clause}",
                        claim_id=claim_id, **updates,
                    )
                    report["updated_nodes"].append(
                        {"type": "Vehicle", "fields": list(updates.keys())}
                    )
            else:
                if any(vehicle_data.get(k) for k in ("vin", "make", "model")):
                    session.run("""
                        MATCH (c:Claim {claim_id: $claim_id})
                        CREATE (v:Vehicle {
                            vehicle_id: 'VEH-' + $doc_id,
                            vin:   $vin,
                            make:  $make,
                            model: $model,
                            year:  $year
                        })
                        CREATE (c)-[:INVOLVES_VEHICLE]->(v)
                    """,
                        claim_id=claim_id, doc_id=doc_id,
                        vin=vehicle_data.get("vin", ""),
                        make=vehicle_data.get("make", ""),
                        model=vehicle_data.get("model", ""),
                        year=vehicle_data.get("year"),
                    )
                    report["created_nodes"].append({"type": "Vehicle"})

        # --- Provider reconciliation ---
        provider_data = (
            extracted.get("shop_info") or
            extracted.get("vendor") or
            extracted.get("provider") or {}
        )
        if isinstance(provider_data, dict) and provider_data.get("name"):
            name     = provider_data["name"]
            existing = session.run("""
                MATCH (p:Provider)
                WHERE toLower(p.name) CONTAINS toLower($name)
                RETURN p LIMIT 1
            """, name=name).single()

            if existing:
                pv = dict(existing["p"])
                updates = {k: v for k, v in {
                    "address":  provider_data.get("address"),
                    "phone":    provider_data.get("phone"),
                    "specialty": provider_data.get("specialty"),
                }.items() if v and not pv.get(k)}
                if updates:
                    set_clause = ", ".join(f"p.{k} = ${k}" for k in updates)
                    session.run(
                        f"MATCH (p:Provider) WHERE toLower(p.name) CONTAINS toLower($name) "
                        f"SET {set_clause}",
                        name=name, **updates,
                    )
                    report["updated_nodes"].append(
                        {"type": "Provider", "name": name, "fields": list(updates.keys())}
                    )
                session.run("""
                    MATCH (d:Document {document_id: $doc_id})
                    MATCH (p:Provider) WHERE toLower(p.name) CONTAINS toLower($name)
                    MERGE (d)-[:MENTIONS_PROVIDER]->(p)
                """, doc_id=doc_id, name=name)
            else:
                session.run("""
                    CREATE (p:Provider {
                        provider_id: 'PROV-' + $doc_id,
                        name:        $name,
                        address:     $address,
                        phone:       $phone,
                        specialty:   $specialty
                    })
                    WITH p
                    MATCH (d:Document {document_id: $doc_id})
                    MERGE (d)-[:MENTIONS_PROVIDER]->(p)
                """,
                    doc_id=doc_id,
                    name=name,
                    address=provider_data.get("address", ""),
                    phone=provider_data.get("phone", ""),
                    specialty=provider_data.get("specialty", ""),
                )
                report["created_nodes"].append({"type": "Provider", "name": name})

        # --- Persist contradictions and signals on Document node ---
        if report["contradictions"] or report["fraud_signals"]:
            session.run("""
                MATCH (d:Document {document_id: $doc_id})
                SET d.contradictions = $contradictions,
                    d.fraud_signals  = $fraud_signals,
                    d.has_red_flags  = true
            """,
                doc_id=doc_id,
                contradictions=report["contradictions"],
                fraud_signals=list(set(report["fraud_signals"])),
            )

    return report


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def extract_document(
    claim_id:  str,
    doc_id:    str,
    file_path: str,
    file_type: str,
    file_name: str,
) -> dict:
    """
    Full pipeline:
    1. LlamaParse REST API  — parse document into clean markdown
    2. Claude               — classify document type
    3. Claude               — extract using type-specific Pydantic schema
    4. Neo4j                — store Document node
    5. Neo4j                — reconcile with existing graph
    """

    # Step 1: Parse
    parsed_text = _parse_with_llama(file_path, file_type)
    parsed_by   = "llamaparse" if parsed_text.strip() else "claude_native"
    content     = _build_claude_content(file_path, file_type, parsed_text)

    # Step 2: Classify
    doc_type = _classify_document(content)
    print(f"[DocumentAgent] Classified as: {doc_type}")

    # Step 3: Extract
    extracted = _extract_with_schema(content, doc_type)
    print(f"[DocumentAgent] Extracted — confidence: {extracted.get('confidence')}")

    # Step 4: Store Document node
    driver = get_driver()
    with driver.session() as session:
        session.run("""
            MATCH (c:Claim {claim_id: $claim_id})
            CREATE (d:Document {
                document_id:       $doc_id,
                claim_id:          $claim_id,
                file_name:         $file_name,
                file_type:         $file_type,
                file_path:         $file_path,
                uploaded_at:       datetime(),
                summary:           $summary,
                document_type:     $document_type,
                extraction_status: 'completed',
                raw_extraction:    $raw_extraction,
                has_red_flags:     false,
                parsed_by:         $parsed_by
            })
            CREATE (c)-[:HAS_DOCUMENT]->(d)
        """,
            claim_id=claim_id,
            doc_id=doc_id,
            file_name=file_name,
            file_type=file_type,
            file_path=file_path,
            summary=extracted.get("summary", ""),
            document_type=doc_type,
            raw_extraction=json.dumps(extracted, default=str),
            parsed_by=parsed_by,
        )

    # Step 5: Reconcile
    reconciliation = _reconcile_with_graph(claim_id, doc_id, doc_type, extracted)

    return {
        "status":         "completed",
        "document_id":    doc_id,
        "document_type":  doc_type,
        "parsed_by":      parsed_by,
        "extracted":      extracted,
        "reconciliation": reconciliation,
        "has_red_flags":  bool(
            reconciliation["contradictions"] or reconciliation["fraud_signals"]
        ),
    }


def get_claim_documents(claim_id: str) -> list[dict]:
    driver = get_driver()
    with driver.session() as session:
        results = session.run("""
            MATCH (c:Claim {claim_id: $claim_id})-[:HAS_DOCUMENT]->(d:Document)
            RETURN d ORDER BY d.uploaded_at DESC
        """, claim_id=claim_id)
        docs = []
        for r in results:
            doc = dict(r["d"])
            if "uploaded_at" in doc and hasattr(doc["uploaded_at"], "iso_format"):
                doc["uploaded_at"] = doc["uploaded_at"].iso_format()
            docs.append(doc)
        return docs
"""
Case management service — stores investigation cases as Neo4j nodes.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from app.db.neo4j import get_driver


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# CREATE
# ---------------------------------------------------------------------------

def create_case(claim_id: str, assigned_to: str, priority: str = "MEDIUM") -> dict:
    driver = get_driver()
    case_id = f"CASE-{uuid.uuid4().hex[:8].upper()}"
    now = _now()

    with driver.session() as s:
        # Check claim exists
        claim = s.run("MATCH (c:Claim {claim_id: $cid}) RETURN c.claim_id AS cid", cid=claim_id).single()
        if not claim:
            return None

        # Check if open case already exists for this claim
        existing = s.run("""
            MATCH (cs:Case)-[:REGARDING]->(c:Claim {claim_id: $cid})
            WHERE cs.status IN ['OPEN', 'IN_REVIEW']
            RETURN cs.case_id AS case_id
        """, cid=claim_id).single()
        if existing:
            return {"error": "open_case_exists", "case_id": existing["case_id"]}

        result = s.run("""
            MATCH (c:Claim {claim_id: $claim_id})
            CREATE (cs:Case {
                case_id:     $case_id,
                status:      'OPEN',
                priority:    $priority,
                assigned_to: $assigned_to,
                notes:       '',
                decision:    '',
                created_at:  $now,
                updated_at:  $now
            })
            CREATE (cs)-[:REGARDING]->(c)
            RETURN cs
        """, claim_id=claim_id, case_id=case_id, priority=priority,
             assigned_to=assigned_to, now=now).single()

        return _format_case(dict(result["cs"]), claim_id)


# ---------------------------------------------------------------------------
# READ
# ---------------------------------------------------------------------------

def get_case(case_id: str) -> dict | None:
    driver = get_driver()
    with driver.session() as s:
        result = s.run("""
            MATCH (cs:Case {case_id: $case_id})-[:REGARDING]->(c:Claim)
            RETURN cs, c.claim_id AS claim_id,
                   c.claim_amount AS claim_amount,
                   c.claim_type AS claim_type,
                   c.fraud_scenario AS fraud_scenario,
                   c.label_is_fraud AS label_is_fraud
        """, case_id=case_id).single()
        if not result:
            return None
        case = _format_case(dict(result["cs"]), result["claim_id"])
        case["claim_amount"]   = result["claim_amount"]
        case["claim_type"]     = result["claim_type"]
        case["fraud_scenario"] = result["fraud_scenario"]
        case["label_is_fraud"] = result["label_is_fraud"]
        return case


def list_cases(status: str | None = None, assigned_to: str | None = None) -> list[dict]:
    driver = get_driver()
    filters = []
    params = {}
    if status:
        filters.append("cs.status = $status")
        params["status"] = status
    if assigned_to:
        filters.append("cs.assigned_to = $assigned_to")
        params["assigned_to"] = assigned_to

    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    with driver.session() as s:
        results = s.run(f"""
            MATCH (cs:Case)-[:REGARDING]->(c:Claim)
            {where}
            RETURN cs, c.claim_id AS claim_id,
                   c.claim_amount AS claim_amount,
                   c.claim_type AS claim_type,
                   c.fraud_scenario AS fraud_scenario,
                   c.label_is_fraud AS label_is_fraud
            ORDER BY cs.created_at DESC
        """, **params).data()

    cases = []
    for r in results:
        case = _format_case(dict(r["cs"]), r["claim_id"])
        case["claim_amount"]   = r["claim_amount"]
        case["claim_type"]     = r["claim_type"]
        case["fraud_scenario"] = r["fraud_scenario"]
        case["label_is_fraud"] = r["label_is_fraud"]
        cases.append(case)
    return cases


def get_case_for_claim(claim_id: str) -> dict | None:
    """Get the active case for a claim if one exists."""
    driver = get_driver()
    with driver.session() as s:
        result = s.run("""
            MATCH (cs:Case)-[:REGARDING]->(c:Claim {claim_id: $claim_id})
            RETURN cs, c.claim_id AS claim_id
            ORDER BY cs.created_at DESC
            LIMIT 1
        """, claim_id=claim_id).single()
        if not result:
            return None
        return _format_case(dict(result["cs"]), result["claim_id"])


# ---------------------------------------------------------------------------
# UPDATE
# ---------------------------------------------------------------------------

def update_case(case_id: str, updates: dict) -> dict | None:
    driver = get_driver()
    allowed = {"status", "notes", "assigned_to", "decision", "priority"}
    filtered = {k: v for k, v in updates.items() if k in allowed}
    if not filtered:
        return get_case(case_id)

    filtered["updated_at"] = _now()
    set_clause = ", ".join([f"cs.{k} = ${k}" for k in filtered])

    with driver.session() as s:
        result = s.run(f"""
            MATCH (cs:Case {{case_id: $case_id}})-[:REGARDING]->(c:Claim)
            SET {set_clause}
            RETURN cs, c.claim_id AS claim_id,
                   c.claim_amount AS claim_amount,
                   c.claim_type AS claim_type,
                   c.fraud_scenario AS fraud_scenario,
                   c.label_is_fraud AS label_is_fraud
        """, case_id=case_id, **filtered).single()

        if not result:
            return None

        # If decision is final — write back to Neo4j claim node
        new_status = filtered.get("status", "")
        if new_status == "CONFIRMED_FRAUD":
            s.run("""
                MATCH (cs:Case {case_id: $case_id})-[:REGARDING]->(c:Claim)
                SET c.label_is_fraud = 1
            """, case_id=case_id)
        elif new_status == "DISMISSED":
            s.run("""
                MATCH (cs:Case {case_id: $case_id})-[:REGARDING]->(c:Claim)
                SET c.label_is_fraud = 0
            """, case_id=case_id)

        case = _format_case(dict(result["cs"]), result["claim_id"])
        case["claim_amount"]   = result["claim_amount"]
        case["claim_type"]     = result["claim_type"]
        case["fraud_scenario"] = result["fraud_scenario"]
        case["label_is_fraud"] = result["label_is_fraud"]
        return case


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------

def delete_case(case_id: str) -> bool:
    driver = get_driver()
    with driver.session() as s:
        result = s.run("""
            MATCH (cs:Case {case_id: $case_id})
            DETACH DELETE cs
            RETURN count(*) AS deleted
        """, case_id=case_id).single()
        return result and result["deleted"] > 0


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def _format_case(props: dict, claim_id: str) -> dict:
    return {
        "case_id":     props.get("case_id"),
        "claim_id":    claim_id,
        "status":      props.get("status"),
        "priority":    props.get("priority"),
        "assigned_to": props.get("assigned_to"),
        "notes":       props.get("notes", ""),
        "decision":    props.get("decision", ""),
        "created_at":  str(props.get("created_at", "")),
        "updated_at":  str(props.get("updated_at", "")),
    }
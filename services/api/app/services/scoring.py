import math
from app.db.neo4j import get_driver
from neo4j.time import Date, DateTime, Duration, Time


def _clean_value(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, str) and v.strip().lower() == "nan":
        return None
    if isinstance(v, (Date, DateTime, Time, Duration)):
        return str(v)
    return v


# Maximum possible raw score — used to normalize to 0-100
MAX_RAW_SCORE = 40 + 20 + 15 + 10 + 10 + 20 + 10 + 5  # = 130 theoretical max
# We cap at a practical max so scores aren't always low
PRACTICAL_MAX = 80


def compute_score(claim: dict, bank_account_claim_count: int, adjuster_is_hub: bool) -> dict:
    """
    Compute a fraud risk score (0-100) for a single claim.
    Returns score + breakdown of contributing signals.
    """
    score = 0
    signals = []

    # Confirmed fraud label
    if claim.get("label_is_fraud") == 1:
        score += 40
        signals.append({"signal": "Confirmed fraud label", "points": 40, "severity": "high"})

    # Fraud scenario present
    fraud_scenario = _clean_value(claim.get("fraud_scenario"))
    if fraud_scenario:
        score += 20
        signals.append({"signal": f"Fraud scenario: {fraud_scenario}", "points": 20, "severity": "high"})

    # Days to file
    days = claim.get("days_to_file")
    if isinstance(days, (int, float)) and not math.isnan(days):
        if days <= 1:
            score += 15
            signals.append({"signal": f"Filed {int(days)} day(s) after incident", "points": 15, "severity": "high"})
        elif days <= 3:
            score += 10
            signals.append({"signal": f"Filed {int(days)} days after incident", "points": 10, "severity": "medium"})

    # Claim amount
    amount = claim.get("claim_amount")
    if isinstance(amount, (int, float)) and not math.isnan(amount):
        if amount > 30000:
            score += 10
            signals.append({"signal": f"Very high claim amount: ${amount:,.2f}", "points": 10, "severity": "medium"})
        elif amount > 10000:
            score += 5
            signals.append({"signal": f"High claim amount: ${amount:,.2f}", "points": 5, "severity": "medium"})

    # Shared bank account
    if bank_account_claim_count >= 3:
        score += 20
        signals.append({
            "signal": f"Bank account shared by {bank_account_claim_count} claims",
            "points": 20,
            "severity": "high",
        })

    # Hub adjuster
    if adjuster_is_hub:
        score += 10
        signals.append({"signal": "Handled by high-volume adjuster", "points": 10, "severity": "medium"})

    # Submission channel
    if claim.get("submission_channel") == "PHONE":
        score += 5
        signals.append({"signal": "Submitted via phone (higher risk channel)", "points": 5, "severity": "low"})

    # Normalize to 0-100
    normalized = min(100, round((score / PRACTICAL_MAX) * 100))

    # Risk level
    if normalized >= 70:
        risk_level = "CRITICAL"
    elif normalized >= 40:
        risk_level = "HIGH"
    elif normalized >= 20:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    return {
        "score": normalized,
        "raw_score": score,
        "risk_level": risk_level,
        "signals": signals,
    }


def get_claim_risk_score(claim_id: str) -> dict | None:
    """
    Fetch claim data from Neo4j, compute and return full risk score with breakdown.
    """
    driver = get_driver()

    query = """
    MATCH (c:Claim {claim_id: $claim_id})
    OPTIONAL MATCH (c)-[:PAID_TO]->(b:BankAccount)
    OPTIONAL MATCH (c)-[:HANDLED_BY]->(a:Adjuster)

    // Count how many claims share the same bank account
    OPTIONAL MATCH (other:Claim)-[:PAID_TO]->(b)
    WITH c, b, a, count(DISTINCT other) AS bank_claim_count

    // Check if adjuster handles more than 50 claims (hub)
    OPTIONAL MATCH (a)<-[:HANDLED_BY]-(adj_claims:Claim)
    WITH c, b, a, bank_claim_count, count(DISTINCT adj_claims) AS adjuster_claim_count

    RETURN
        c                          AS claim,
        b.bank_account_id          AS bank_account_id,
        bank_claim_count           AS bank_claim_count,
        a.adjuster_id              AS adjuster_id,
        adjuster_claim_count       AS adjuster_claim_count
    """

    with driver.session() as session:
        record = session.run(query, claim_id=claim_id).single()
        if not record:
            return None

        claim_props = {k: _clean_value(v) for k, v in dict(record["claim"]).items()}
        bank_claim_count = record["bank_claim_count"] or 0
        adjuster_claim_count = record["adjuster_claim_count"] or 0
        adjuster_is_hub = adjuster_claim_count > 50

        result = compute_score(claim_props, bank_claim_count, adjuster_is_hub)
        result["claim_id"] = claim_id
        result["bank_account_id"] = record["bank_account_id"]
        result["bank_claim_count"] = bank_claim_count
        result["adjuster_id"] = record["adjuster_id"]
        result["adjuster_claim_count"] = adjuster_claim_count

        return result
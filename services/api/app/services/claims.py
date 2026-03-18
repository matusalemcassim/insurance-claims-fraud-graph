import math
from app.db.neo4j import get_driver
from neo4j.time import Date, DateTime, Duration, Time


def _clean_value(v):
    """Convert NaN -> None and Neo4j types -> serializable."""
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, str) and v.strip().lower() == "nan":
        return None
    if isinstance(v, (Date, DateTime, Time, Duration)):
        return str(v)
    return v


def _clean_dict(d: dict):
    return {k: _clean_value(v) for k, v in d.items()}


def get_claim(claim_id: str):
    driver = get_driver()
    query = """
    MATCH (c:Claim {claim_id: $claim_id})
    OPTIONAL MATCH (c)<-[:HAS_CLAIM]-(p:Policy)
    OPTIONAL MATCH (ph:PolicyHolder)-[:HAS_POLICY]->(p)
    OPTIONAL MATCH (c)-[:PAID_TO]->(b:BankAccount)
    OPTIONAL MATCH (c)-[:INVOLVES_PROVIDER]->(pr:Provider)
    OPTIONAL MATCH (c)-[:INVOLVES_VEHICLE]->(v:Vehicle)
    OPTIONAL MATCH (c)-[:HANDLED_BY]->(a:Adjuster)
    RETURN
        c,
        ph.policyholder_id AS policyholder_id,
        b.bank_account_id  AS bank_account_id,
        pr.provider_id     AS provider_id,
        v.vehicle_id       AS vehicle_id,
        a.adjuster_id      AS adjuster_id
    """
    with driver.session() as session:
        record = session.run(query, claim_id=claim_id).single()
        if record is None:
            return None
        claim_data = _clean_dict(dict(record["c"]))
        links = {k: _clean_value(record[k]) for k in [
            "policyholder_id", "bank_account_id",
            "provider_id", "vehicle_id", "adjuster_id",
        ]}
        return {"claim": claim_data, "links": links}


def get_flagged_claims(limit: int = 200):
    """
    Return claims that are confirmed fraud OR have a fraud_scenario set.
    Ordered by claim_amount descending so highest-value risks appear first.
    """
    driver = get_driver()
    query = """
    MATCH (c:Claim)
    WHERE c.label_is_fraud = 1 OR (c.fraud_scenario IS NOT NULL AND c.fraud_scenario <> '')
    OPTIONAL MATCH (c)<-[:HAS_CLAIM]-(p:Policy)
    OPTIONAL MATCH (ph:PolicyHolder)-[:HAS_POLICY]->(p)
    OPTIONAL MATCH (c)-[:PAID_TO]->(b:BankAccount)
    OPTIONAL MATCH (c)-[:HANDLED_BY]->(a:Adjuster)
    RETURN
        c.claim_id        AS claim_id,
        c.claim_type      AS claim_type,
        c.claim_amount    AS claim_amount,
        c.label_is_fraud  AS label_is_fraud,
        c.fraud_scenario  AS fraud_scenario,
        c.days_to_file    AS days_to_file,
        c.filed_date      AS filed_date,
        c.status          AS status,
        ph.policyholder_id AS policyholder_id,
        b.bank_account_id  AS bank_account_id,
        a.adjuster_id      AS adjuster_id
    ORDER BY c.claim_amount DESC
    LIMIT $limit
    """
    with driver.session() as session:
        records = session.run(query, limit=limit).data()

    results = []
    for r in records:
        results.append({
            "claim_id":        r["claim_id"],
            "claim_type":      _clean_value(r["claim_type"]),
            "claim_amount":    _clean_value(r["claim_amount"]),
            "label_is_fraud":  r["label_is_fraud"],
            "fraud_scenario":  _clean_value(r["fraud_scenario"]),
            "days_to_file":    _clean_value(r["days_to_file"]),
            "filed_date":      _clean_value(r["filed_date"]),
            "status":          _clean_value(r["status"]),
            "policyholder_id": _clean_value(r["policyholder_id"]),
            "bank_account_id": _clean_value(r["bank_account_id"]),
            "adjuster_id":     _clean_value(r["adjuster_id"]),
        })
    return results
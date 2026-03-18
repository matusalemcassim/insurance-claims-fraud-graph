import math
from app.db.neo4j import get_driver
from neo4j.time import Date, DateTime, Duration, Time


def _clean(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, str) and v.strip().lower() == "nan":
        return None
    if isinstance(v, (Date, DateTime, Time, Duration)):
        return str(v)
    return v


def detect_shared_bank_account_rings(min_claims: int = 3) -> list[dict]:
    """
    Find BankAccount nodes receiving payments from 3+ distinct claims.
    Classic fraud ring: multiple claimants routing payouts to the same account.
    """
    driver = get_driver()
    query = """
    MATCH (c:Claim)-[:PAID_TO]->(b:BankAccount)
    WITH b, collect(c.claim_id) AS claim_ids,
         sum(c.claim_amount)    AS total_amount,
         count(c)               AS claim_count
    WHERE claim_count >= $min_claims
    RETURN
        b.bank_account_id AS bank_account_id,
        b.bank_name       AS bank_name,
        claim_ids,
        claim_count,
        total_amount
    ORDER BY claim_count DESC
    """
    with driver.session() as session:
        records = session.run(query, min_claims=min_claims).data()

    return [
        {
            "pattern":         "shared_bank_account_ring",
            "pattern_label":   "Shared Bank Account Ring",
            "severity":        "high",
            "bank_account_id": r["bank_account_id"],
            "bank_name":       r["bank_name"],
            "claim_ids":       r["claim_ids"],
            "claim_count":     r["claim_count"],
            "total_amount":    _clean(r["total_amount"]),
            "description": (
                f"Bank account {r['bank_account_id']} ({r['bank_name']}) "
                f"received payouts from {r['claim_count']} claims "
                f"totalling ${_clean(r['total_amount']) or 0:,.2f}."
            ),
        }
        for r in records
    ]


def detect_adjuster_overload(min_claims: int = 50) -> list[dict]:
    """
    Find Adjuster nodes handling an abnormally high number of claims.
    May indicate a corrupt adjuster approving fraudulent claims.
    """
    driver = get_driver()
    query = """
    MATCH (c:Claim)-[:HANDLED_BY]->(a:Adjuster)
    WITH a, collect(c.claim_id) AS claim_ids,
         sum(c.claim_amount)    AS total_amount,
         count(c)               AS claim_count,
         sum(CASE WHEN c.label_is_fraud = 1 THEN 1 ELSE 0 END) AS fraud_count
    WHERE claim_count >= $min_claims
    RETURN
        a.adjuster_id  AS adjuster_id,
        claim_ids,
        claim_count,
        fraud_count,
        total_amount
    ORDER BY fraud_count DESC, claim_count DESC
    """
    with driver.session() as session:
        records = session.run(query, min_claims=min_claims).data()

    return [
        {
            "pattern":       "adjuster_overload",
            "pattern_label": "Adjuster Overload",
            "severity":      "high" if r["fraud_count"] > 0 else "medium",
            "adjuster_id":   r["adjuster_id"],
            "claim_ids":     r["claim_ids"],
            "claim_count":   r["claim_count"],
            "fraud_count":   r["fraud_count"],
            "total_amount":  _clean(r["total_amount"]),
            "description": (
                f"Adjuster {r['adjuster_id']} handled {r['claim_count']} claims "
                f"({r['fraud_count']} confirmed fraud) "
                f"totalling ${_clean(r['total_amount']) or 0:,.2f}."
            ),
        }
        for r in records
    ]


def detect_rapid_reclaim_clusters(min_claims: int = 3, days_window: int = 90) -> list[dict]:
    """
    Find PolicyHolder nodes with multiple claims filed within a short window.
    Rapid re-filing after payouts is a key fraud indicator.
    """
    driver = get_driver()
    query = """
    MATCH (ph:PolicyHolder)-[:HAS_POLICY]->(p:Policy)-[:HAS_CLAIM]->(c:Claim)
    WITH ph,
         collect(c.claim_id)   AS claim_ids,
         collect(c.filed_date) AS filed_dates,
         sum(c.claim_amount)   AS total_amount,
         count(c)              AS claim_count,
         min(c.filed_date)     AS earliest,
         max(c.filed_date)     AS latest
    WHERE claim_count >= $min_claims
    WITH ph, claim_ids, filed_dates, total_amount, claim_count, earliest, latest,
         duration.between(earliest, latest).days AS date_span_days
    WHERE date_span_days <= $days_window
    RETURN
        ph.policyholder_id AS policyholder_id,
        claim_ids,
        claim_count,
        total_amount,
        earliest,
        latest,
        date_span_days
    ORDER BY claim_count DESC
    """
    with driver.session() as session:
        records = session.run(query, min_claims=min_claims, days_window=days_window).data()

    results = []
    for r in records:
        results.append({
            "pattern":         "rapid_reclaim_cluster",
            "pattern_label":   "Rapid Re-claim Cluster",
            "severity":        "high",
            "policyholder_id": r["policyholder_id"],
            "claim_ids":       r["claim_ids"],
            "claim_count":     r["claim_count"],
            "total_amount":    _clean(r["total_amount"]),
            "date_span_days":  r["date_span_days"],
            "earliest_claim":  _clean(r["earliest"]),
            "latest_claim":    _clean(r["latest"]),
            "description": (
                f"Policyholder {r['policyholder_id']} filed {r['claim_count']} claims "
                f"within {r['date_span_days']} days "
                f"(${_clean(r['total_amount']) or 0:,.2f} total)."
            ),
        })
    return results


def detect_shared_representative(min_claims: int = 3) -> list[dict]:
    """
    Find legal/medical representatives handling claims for multiple distinct policyholders.
    A single representative appearing across many unrelated claims is a fraud ring signal.
    """
    driver = get_driver()
    query = """
    MATCH (c:Claim)-[:REPRESENTED_BY]->(rep)
    WITH rep, collect(c.claim_id) AS claim_ids,
         count(DISTINCT c)        AS claim_count,
         sum(c.claim_amount)      AS total_amount,
         labels(rep)[0]           AS rep_type
    WHERE claim_count >= $min_claims
    RETURN
        elementId(rep) AS rep_id,
        rep_type,
        claim_ids,
        claim_count,
        total_amount
    ORDER BY claim_count DESC
    """
    with driver.session() as session:
        records = session.run(query, min_claims=min_claims).data()

    return [
        {
            "pattern":       "shared_representative",
            "pattern_label": "Shared Legal/Medical Representative",
            "severity":      "medium",
            "rep_id":        str(r["rep_id"]),
            "rep_type":      r["rep_type"],
            "claim_ids":     r["claim_ids"],
            "claim_count":   r["claim_count"],
            "total_amount":  _clean(r["total_amount"]),
            "description": (
                f"A {r['rep_type']} representative (id: {r['rep_id']}) "
                f"appears across {r['claim_count']} claims "
                f"totalling ${_clean(r['total_amount']) or 0:,.2f}."
            ),
        }
        for r in records
    ]


def detect_all_patterns() -> dict:
    """Run all pattern detectors and return combined results."""
    shared_bank   = detect_shared_bank_account_rings()
    adj_overload  = detect_adjuster_overload()
    rapid_reclaim = detect_rapid_reclaim_clusters()
    shared_rep    = detect_shared_representative()

    all_patterns = shared_bank + adj_overload + rapid_reclaim + shared_rep

    return {
        "total_patterns":  len(all_patterns),
        "high_severity":   sum(1 for p in all_patterns if p["severity"] == "high"),
        "medium_severity": sum(1 for p in all_patterns if p["severity"] == "medium"),
        "patterns": {
            "shared_bank_account_rings": shared_bank,
            "adjuster_overload":         adj_overload,
            "rapid_reclaim_clusters":    rapid_reclaim,
            "shared_representatives":    shared_rep,
        },
    }
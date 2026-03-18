"""
ML fraud scoring service.
Loads the trained XGBoost model and scores individual claims.
"""
from __future__ import annotations
import json
import math
import os
import numpy as np
import pandas as pd
from xgboost import XGBClassifier
from neo4j.time import Date, DateTime, Duration, Time
from app.db.neo4j import get_driver

_BASE         = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR     = os.path.normpath(os.path.join(_BASE, "..", "ml"))
MODEL_PATH    = os.path.join(MODEL_DIR, "fraud_model.json")
FEATURES_PATH = os.path.join(MODEL_DIR, "features.json")

_model: XGBClassifier | None = None
_feature_cols: list[str] | None = None


def _load_model():
    global _model, _feature_cols
    if _model is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"Model not found at {MODEL_PATH}. "
                "Run scripts/train_model.py first."
            )
        m = XGBClassifier()
        m.load_model(MODEL_PATH)
        _model = m
        with open(FEATURES_PATH) as f:
            _feature_cols = json.load(f)


def _clean(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, str) and v.strip().lower() == "nan":
        return None
    if isinstance(v, (Date, DateTime, Time, Duration)):
        return str(v)
    return v


CLAIM_QUERY = """
MATCH (c:Claim {claim_id: $claim_id})
OPTIONAL MATCH (c)-[:PAID_TO]->(b:BankAccount)
OPTIONAL MATCH (c)-[:HANDLED_BY]->(a:Adjuster)
OPTIONAL MATCH (po:Policy)-[:HAS_CLAIM]->(c)
OPTIONAL MATCH (ph:PolicyHolder)-[:HAS_POLICY]->(po)
OPTIONAL MATCH (c)-[:REPRESENTED_BY]->(lf)

OPTIONAL MATCH (other_c:Claim)-[:PAID_TO]->(b)
WITH c, b, a, ph, lf, count(DISTINCT other_c) AS bank_claim_count

OPTIONAL MATCH (a)<-[:HANDLED_BY]-(adj_c:Claim)
WITH c, b, a, ph, lf, bank_claim_count, count(DISTINCT adj_c) AS adjuster_claim_count

OPTIONAL MATCH (ph)-[:HAS_POLICY]->(any_po:Policy)-[:HAS_CLAIM]->(ph_c:Claim)
WITH c, b, a, ph, lf, bank_claim_count, adjuster_claim_count,
     count(DISTINCT ph_c) AS policyholder_claim_count

RETURN
    c.claim_amount          AS claim_amount,
    c.approved_amount       AS approved_amount,
    c.days_to_file          AS days_to_file,
    c.claim_type            AS claim_type,
    c.submission_channel    AS submission_channel,
    c.status                AS status,
    bank_claim_count        AS bank_claim_count,
    adjuster_claim_count    AS adjuster_claim_count,
    policyholder_claim_count AS policyholder_claim_count,
    CASE WHEN lf IS NOT NULL THEN 1 ELSE 0 END AS has_law_firm
"""


def _build_feature_row(record: dict, feature_cols: list[str]) -> pd.DataFrame:
    claim_amount   = float(record.get("claim_amount") or 0)
    approved_amount = float(record.get("approved_amount") or 0)
    days_to_file   = float(record.get("days_to_file") or 0)
    bank_claim_count = int(record.get("bank_claim_count") or 0)
    adjuster_claim_count = int(record.get("adjuster_claim_count") or 0)
    policyholder_claim_count = int(record.get("policyholder_claim_count") or 0)
    has_law_firm   = int(record.get("has_law_firm") or 0)
    claim_type     = record.get("claim_type") or ""
    submission_channel = record.get("submission_channel") or ""
    status         = record.get("status") or ""

    row = {
        "claim_amount":             claim_amount,
        "days_to_file":             days_to_file,
        "bank_claim_count":         bank_claim_count,
        "adjuster_claim_count":     adjuster_claim_count,
        "policyholder_claim_count": policyholder_claim_count,
        "has_law_firm":             has_law_firm,
        "approved_ratio":           (approved_amount / claim_amount) if claim_amount > 0 else 0,
        "amount_log":               np.log1p(claim_amount),
        "is_fast_filer":            int(days_to_file <= 2),
        "is_high_value":            int(claim_amount > 15000),
        "bank_shared":              int(bank_claim_count >= 3),
        "adjuster_hub":             int(adjuster_claim_count > 50),
        "ph_multi_claim":           int(policyholder_claim_count >= 3),
        # one-hot claim type
        "claim_type_AUTO":          int(claim_type == "AUTO"),
        "claim_type_HOME":          int(claim_type == "HOME"),
        "claim_type_HEALTH":        int(claim_type == "HEALTH"),
        # one-hot channel
        "submission_channel_WEB":   int(submission_channel == "WEB"),
        "submission_channel_PHONE": int(submission_channel == "PHONE"),
        "submission_channel_AGENT": int(submission_channel == "AGENT"),
        # one-hot status
        "status_APPROVED":          int(status == "APPROVED"),
        "status_DENIED":            int(status == "DENIED"),
        "status_PENDING":           int(status == "PENDING"),
    }

    # Align to training feature columns — fill missing with 0
    df = pd.DataFrame([row])
    for col in feature_cols:
        if col not in df.columns:
            df[col] = 0
    df = df[feature_cols].fillna(0)
    return df


def get_ml_score(claim_id: str) -> dict | None:
    _load_model()
    driver = get_driver()

    with driver.session() as session:
        record = session.run(CLAIM_QUERY, claim_id=claim_id).single()
        if not record:
            return None
        data = dict(record)

    feature_row = _build_feature_row(data, _feature_cols)
    prob = float(_model.predict_proba(feature_row)[0][1])
    score = round(prob * 100, 1)

    if prob >= 0.75:
        risk_level = "CRITICAL"
    elif prob >= 0.50:
        risk_level = "HIGH"
    elif prob >= 0.25:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    return {
        "claim_id":   claim_id,
        "ml_score":   score,
        "probability": round(prob, 4),
        "risk_level": risk_level,
        "model":      "XGBoost v1",
        "features_used": len(_feature_cols),
    }
"""
Train an XGBoost fraud detection model on the full Neo4j dataset.
Run from project root:
    poetry run python scripts/train_model.py

Saves model to: services/api/app/ml/fraud_model.json
Saves feature list to: services/api/app/ml/features.json
"""
from __future__ import annotations
import os
import json
import numpy as np
import pandas as pd
from neo4j import GraphDatabase
from dotenv import load_dotenv
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    classification_report, roc_auc_score,
    precision_recall_curve, confusion_matrix,
)
from xgboost import XGBClassifier

load_dotenv(Path(__file__).parent.parent / "services/api/.env")

NEO4J_URI      = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER     = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")
MODEL_DIR = str(Path(__file__).parent.parent / "services/api/app/ml")

# ---------------------------------------------------------------------------
# 1. EXTRACT FEATURES FROM NEO4J
# ---------------------------------------------------------------------------

FEATURE_QUERY = """
MATCH (c:Claim)
OPTIONAL MATCH (c)-[:PAID_TO]->(b:BankAccount)
OPTIONAL MATCH (c)-[:HANDLED_BY]->(a:Adjuster)
OPTIONAL MATCH (po:Policy)-[:HAS_CLAIM]->(c)
OPTIONAL MATCH (ph:PolicyHolder)-[:HAS_POLICY]->(po)
OPTIONAL MATCH (c)-[:REPRESENTED_BY]->(lf)

// Graph features: count how many claims share the same bank account
OPTIONAL MATCH (other_c:Claim)-[:PAID_TO]->(b)
WITH c, b, a, ph, lf,
     count(DISTINCT other_c) AS bank_claim_count

// Count how many claims this adjuster handles
OPTIONAL MATCH (a)<-[:HANDLED_BY]-(adj_c:Claim)
WITH c, b, a, ph, lf, bank_claim_count,
     count(DISTINCT adj_c) AS adjuster_claim_count

// Count how many claims this policyholder has filed
OPTIONAL MATCH (ph)-[:HAS_POLICY]->(any_po:Policy)-[:HAS_CLAIM]->(ph_c:Claim)
WITH c, b, a, ph, lf, bank_claim_count, adjuster_claim_count,
     count(DISTINCT ph_c) AS policyholder_claim_count

RETURN
    c.claim_id              AS claim_id,
    c.claim_amount          AS claim_amount,
    c.approved_amount       AS approved_amount,
    c.days_to_file          AS days_to_file,
    c.claim_type            AS claim_type,
    c.submission_channel    AS submission_channel,
    c.status                AS status,
    c.label_is_fraud        AS label_is_fraud,
    bank_claim_count        AS bank_claim_count,
    adjuster_claim_count    AS adjuster_claim_count,
    policyholder_claim_count AS policyholder_claim_count,
    CASE WHEN lf IS NOT NULL THEN 1 ELSE 0 END AS has_law_firm
"""


def extract_features() -> pd.DataFrame:
    print("Connecting to Neo4j...")
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    driver.verify_connectivity()

    print("Extracting features from Neo4j (this may take 30-60 seconds)...")
    with driver.session() as session:
        records = session.run(FEATURE_QUERY).data()
    driver.close()

    print(f"  Fetched {len(records)} claims")
    df = pd.DataFrame(records)
    return df


# ---------------------------------------------------------------------------
# 2. FEATURE ENGINEERING
# ---------------------------------------------------------------------------

def engineer_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    # Derived features
    df["approved_ratio"] = (
        df["approved_amount"] / df["claim_amount"].replace(0, np.nan)
    ).fillna(0).clip(0, 2)

    df["amount_log"] = np.log1p(df["claim_amount"].fillna(0))
    df["is_fast_filer"] = (df["days_to_file"] <= 2).astype(int)
    df["is_high_value"] = (df["claim_amount"] > df["claim_amount"].quantile(0.75)).astype(int)
    df["bank_shared"] = (df["bank_claim_count"] >= 3).astype(int)
    df["adjuster_hub"] = (df["adjuster_claim_count"] > 50).astype(int)
    df["ph_multi_claim"] = (df["policyholder_claim_count"] >= 3).astype(int)

    # One-hot encode categoricals
    df = pd.get_dummies(df, columns=["claim_type", "submission_channel", "status"], dtype=int)

    # Final feature list — everything except IDs and label
    exclude = {"claim_id", "label_is_fraud", "approved_amount"}
    feature_cols = [c for c in df.columns if c not in exclude]

    # Fill any remaining NaN
    df[feature_cols] = df[feature_cols].fillna(0)

    return df, feature_cols


# ---------------------------------------------------------------------------
# 3. TRAIN
# ---------------------------------------------------------------------------

def train(df: pd.DataFrame, feature_cols: list[str]):
    X = df[feature_cols]
    y = df["label_is_fraud"].astype(int)

    fraud_count = y.sum()
    legit_count = (y == 0).sum()
    scale_pos_weight = legit_count / fraud_count
    print(f"\nClass distribution: {legit_count} legit, {fraud_count} fraud")
    print(f"scale_pos_weight: {scale_pos_weight:.2f}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=scale_pos_weight,
        eval_metric="auc",
        random_state=42,
        verbosity=0,
    )

    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )

    # Evaluation
    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= 0.5).astype(int)
    auc = roc_auc_score(y_test, y_prob)

    print("\n--- Model Evaluation ---")
    print(f"AUC-ROC: {auc:.4f}")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred, target_names=["Legit", "Fraud"]))
    print("Confusion Matrix:")
    print(confusion_matrix(y_test, y_pred))

    # Feature importance
    importance = pd.Series(model.feature_importances_, index=feature_cols)
    print("\nTop 10 Feature Importances:")
    print(importance.nlargest(10).to_string())

    return model


# ---------------------------------------------------------------------------
# 4. SAVE
# ---------------------------------------------------------------------------

def save(model: XGBClassifier, feature_cols: list[str]):
    os.makedirs(MODEL_DIR, exist_ok=True)
    model_path = f"{MODEL_DIR}/fraud_model.json"
    features_path = f"{MODEL_DIR}/features.json"

    model.save_model(model_path)
    with open(features_path, "w") as f:
        json.dump(feature_cols, f)

    print(f"\n✅ Model saved to {model_path}")
    print(f"✅ Features saved to {features_path}")


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    df = extract_features()
    df, feature_cols = engineer_features(df)
    model = train(df, feature_cols)
    save(model, feature_cols)
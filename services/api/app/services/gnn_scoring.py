"""
GNN fraud scoring service.
Loads trained GraphSAGE model and scores individual claims.
"""
from __future__ import annotations
import json
import math
import os
import numpy as np
import torch
import torch.nn.functional as F
from torch_geometric.nn import SAGEConv
from neo4j.time import Date, DateTime, Duration, Time
from app.db.neo4j import get_driver

_BASE         = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR     = os.path.normpath(os.path.join(_BASE, "..", "ml"))
MODEL_PATH    = os.path.join(MODEL_DIR, "gnn_model.pt")
META_PATH     = os.path.join(MODEL_DIR, "gnn_meta.json")

_model = None
_meta  = None


class FraudGraphSAGE(torch.nn.Module):
    def __init__(self, in_channels: int, hidden_channels: int = 64, out_channels: int = 2):
        super().__init__()
        self.conv1 = SAGEConv(in_channels, hidden_channels)
        self.conv2 = SAGEConv(hidden_channels, hidden_channels)
        self.conv3 = SAGEConv(hidden_channels, hidden_channels // 2)
        self.classifier = torch.nn.Linear(hidden_channels // 2, out_channels)
        self.dropout = torch.nn.Dropout(0.3)

    def forward(self, x, edge_index):
        x = self.conv1(x, edge_index)
        x = F.relu(x)
        x = self.dropout(x)
        x = self.conv2(x, edge_index)
        x = F.relu(x)
        x = self.dropout(x)
        x = self.conv3(x, edge_index)
        x = F.relu(x)
        x = self.classifier(x)
        return x


def _load_model():
    global _model, _meta
    if _model is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"GNN model not found at {MODEL_PATH}. "
                "Run scripts/train_gnn.py first."
            )
        with open(META_PATH) as f:
            _meta = json.load(f)

        model = FraudGraphSAGE(in_channels=_meta["n_features"])
        model.load_state_dict(torch.load(MODEL_PATH, map_location="cpu", weights_only=True))
        model.eval()
        _model = model


NEIGHBOR_QUERY = """
MATCH (c:Claim {claim_id: $claim_id})
OPTIONAL MATCH (c)-[:PAID_TO]->(b:BankAccount)<-[:PAID_TO]-(neighbor:Claim)
OPTIONAL MATCH (c)-[:HANDLED_BY]->(a:Adjuster)<-[:HANDLED_BY]-(adj_neighbor:Claim)
WITH c,
     collect(DISTINCT neighbor.claim_id)[..20]    AS bank_neighbors,
     collect(DISTINCT adj_neighbor.claim_id)[..20] AS adj_neighbors,
     count(DISTINCT neighbor)                      AS bank_claim_count,
     count(DISTINCT adj_neighbor)                  AS adjuster_claim_count
OPTIONAL MATCH (po:Policy)-[:HAS_CLAIM]->(c)
OPTIONAL MATCH (ph:PolicyHolder)-[:HAS_POLICY]->(po)
OPTIONAL MATCH (ph)-[:HAS_POLICY]->(any_po:Policy)-[:HAS_CLAIM]->(ph_c:Claim)
WITH c, bank_neighbors, adj_neighbors, bank_claim_count, adjuster_claim_count,
     count(DISTINCT ph_c) AS ph_claim_count
OPTIONAL MATCH (c)-[:REPRESENTED_BY]->(lf)
RETURN
    c.claim_amount       AS claim_amount,
    c.days_to_file       AS days_to_file,
    c.approved_amount    AS approved_amount,
    c.claim_type         AS claim_type,
    c.submission_channel AS submission_channel,
    bank_claim_count     AS bank_claim_count,
    adjuster_claim_count AS adjuster_claim_count,
    ph_claim_count       AS ph_claim_count,
    bank_neighbors       AS bank_neighbors,
    adj_neighbors        AS adj_neighbors,
    CASE WHEN lf IS NOT NULL THEN 1 ELSE 0 END AS has_law_firm
"""


def _build_features(record: dict) -> list[float]:
    amt      = float(record.get("claim_amount") or 0)
    days     = float(record.get("days_to_file") or 0)
    approved = float(record.get("approved_amount") or 0)
    bank_cnt = float(record.get("bank_claim_count") or 0)
    adj_cnt  = float(record.get("adjuster_claim_count") or 0)
    ph_cnt   = float(record.get("ph_claim_count") or 0)
    law_firm = float(record.get("has_law_firm") or 0)
    ratio    = (approved / amt) if amt > 0 else 0.0
    ct       = record.get("claim_type") or ""
    ch       = record.get("submission_channel") or ""

    return [
        np.log1p(amt),
        days / 30.0,
        ratio,
        min(bank_cnt, 30) / 30,
        min(adj_cnt, 200) / 200,
        min(ph_cnt, 20) / 20,
        law_firm,
        float(days <= 2),
        float(amt > 15000),
        float(bank_cnt >= 3),
        float(ct == "AUTO"), float(ct == "HOME"), float(ct == "HEALTH"),
        float(ch == "WEB"),  float(ch == "PHONE"), float(ch == "AGENT"),
    ]


def get_gnn_score(claim_id: str) -> dict | None:
    _load_model()
    driver = get_driver()

    with driver.session() as session:
        record = session.run(NEIGHBOR_QUERY, claim_id=claim_id).single()
        if not record:
            return None
        data = dict(record)

    # Build a small local subgraph: target claim + its neighbors
    bank_neighbors = data.get("bank_neighbors") or []
    adj_neighbors  = data.get("adj_neighbors") or []
    neighbor_ids   = list(set(bank_neighbors + adj_neighbors))

    # Fetch neighbor features if we have neighbors
    all_features = [_build_features(data)]  # index 0 = target claim
    node_map = {claim_id: 0}

    if neighbor_ids:
        neighbor_query = """
        UNWIND $ids AS cid
        MATCH (c:Claim {claim_id: cid})
        OPTIONAL MATCH (c)-[:PAID_TO]->(b:BankAccount)
        OPTIONAL MATCH (c)-[:HANDLED_BY]->(a:Adjuster)
        OPTIONAL MATCH (other:Claim)-[:PAID_TO]->(b)
        WITH c, count(DISTINCT other) AS bank_cnt
        OPTIONAL MATCH (a)<-[:HANDLED_BY]-(adj_c:Claim)
        WITH c, bank_cnt, count(DISTINCT adj_c) AS adj_cnt
        RETURN
            c.claim_id AS claim_id, c.claim_amount AS claim_amount,
            c.days_to_file AS days_to_file, c.approved_amount AS approved_amount,
            c.claim_type AS claim_type, c.submission_channel AS submission_channel,
            bank_cnt AS bank_claim_count, adj_cnt AS adjuster_claim_count,
            0 AS ph_claim_count, 0 AS has_law_firm
        """
        with driver.session() as session:
            neighbors = session.run(neighbor_query, ids=neighbor_ids).data()

        for nb in neighbors:
            nid = nb["claim_id"]
            if nid not in node_map:
                node_map[nid] = len(all_features)
                all_features.append(_build_features(nb))

    # Build edge index for local subgraph
    src_list, dst_list = [], []
    target_idx = node_map[claim_id]

    for nid in bank_neighbors:
        if nid in node_map:
            n_idx = node_map[nid]
            src_list += [target_idx, n_idx]
            dst_list += [n_idx, target_idx]

    for nid in adj_neighbors:
        if nid in node_map:
            n_idx = node_map[nid]
            src_list += [target_idx, n_idx]
            dst_list += [n_idx, target_idx]

    x = torch.tensor(all_features, dtype=torch.float)

    if src_list:
        edge_index = torch.tensor([src_list, dst_list], dtype=torch.long)
    else:
        # No edges — self-loop so message passing doesn't fail
        edge_index = torch.tensor([[0], [0]], dtype=torch.long)

    # Inference
    with torch.no_grad():
        _model.eval()
        out = _model(x, edge_index)
        probs = F.softmax(out, dim=1)
        prob = float(probs[target_idx, 1].item())

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
        "claim_id":       claim_id,
        "gnn_score":      score,
        "probability":    round(prob, 4),
        "risk_level":     risk_level,
        "model":          "GraphSAGE v1",
        "neighbors_used": len(neighbor_ids),
    }
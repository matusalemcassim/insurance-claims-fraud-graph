"""
Train a GraphSAGE fraud detection model on the Neo4j graph.
Run from project root:
    cd services/api
    poetry run python ../../scripts/train_gnn.py

Saves model to: services/api/app/ml/gnn_model.pt
Saves metadata to: services/api/app/ml/gnn_meta.json
"""
from __future__ import annotations
import os
import json
import numpy as np
import torch
import torch.nn.functional as F
from torch_geometric.nn import SAGEConv
from torch_geometric.data import Data
from neo4j import GraphDatabase
from dotenv import load_dotenv
from pathlib import Path
from sklearn.metrics import roc_auc_score, classification_report
from sklearn.model_selection import train_test_split

load_dotenv(Path(__file__).parent.parent / "services/api/.env")

NEO4J_URI      = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER     = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")
MODEL_DIR      = str(Path(__file__).parent.parent / "services/api/app/ml")

# ---------------------------------------------------------------------------
# 1. EXTRACT GRAPH FROM NEO4J
# ---------------------------------------------------------------------------

NODES_QUERY = """
MATCH (c:Claim)
OPTIONAL MATCH (c)-[:PAID_TO]->(b:BankAccount)
OPTIONAL MATCH (c)-[:HANDLED_BY]->(a:Adjuster)
OPTIONAL MATCH (po:Policy)-[:HAS_CLAIM]->(c)
OPTIONAL MATCH (ph:PolicyHolder)-[:HAS_POLICY]->(po)
OPTIONAL MATCH (c)-[:REPRESENTED_BY]->(lf)

OPTIONAL MATCH (other:Claim)-[:PAID_TO]->(b)
WITH c, b, a, ph, lf, count(DISTINCT other) AS bank_claim_count

OPTIONAL MATCH (a)<-[:HANDLED_BY]-(adj_c:Claim)
WITH c, b, a, ph, lf, bank_claim_count, count(DISTINCT adj_c) AS adjuster_claim_count

OPTIONAL MATCH (ph)-[:HAS_POLICY]->(any_po:Policy)-[:HAS_CLAIM]->(ph_c:Claim)
WITH c, b, a, ph, lf, bank_claim_count, adjuster_claim_count,
     count(DISTINCT ph_c) AS ph_claim_count

RETURN
    c.claim_id              AS claim_id,
    c.claim_amount          AS claim_amount,
    c.days_to_file          AS days_to_file,
    c.approved_amount       AS approved_amount,
    c.label_is_fraud        AS label_is_fraud,
    c.claim_type            AS claim_type,
    c.submission_channel    AS submission_channel,
    CASE WHEN lf IS NOT NULL THEN 1 ELSE 0 END AS has_law_firm,
    bank_claim_count        AS bank_claim_count,
    adjuster_claim_count    AS adjuster_claim_count,
    ph_claim_count          AS ph_claim_count
"""

# Edges: claims sharing a bank account are connected
EDGES_QUERY = """
MATCH (c1:Claim)-[:PAID_TO]->(b:BankAccount)<-[:PAID_TO]-(c2:Claim)
WHERE c1.claim_id < c2.claim_id
RETURN c1.claim_id AS src, c2.claim_id AS dst
LIMIT 100000
"""

# Also connect claims handled by same adjuster
ADJUSTER_EDGES_QUERY = """
MATCH (c1:Claim)-[:HANDLED_BY]->(a:Adjuster)<-[:HANDLED_BY]-(c2:Claim)
WHERE c1.claim_id < c2.claim_id
RETURN c1.claim_id AS src, c2.claim_id AS dst
LIMIT 50000
"""


def extract_graph():
    print("Connecting to Neo4j...")
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    driver.verify_connectivity()

    print("Extracting node features...")
    with driver.session() as s:
        nodes = s.run(NODES_QUERY).data()

    print(f"  {len(nodes)} claim nodes")

    print("Extracting edges (shared bank account)...")
    with driver.session() as s:
        bank_edges = s.run(EDGES_QUERY).data()
    print(f"  {len(bank_edges)} bank account edges")

    print("Extracting edges (shared adjuster)...")
    with driver.session() as s:
        adj_edges = s.run(ADJUSTER_EDGES_QUERY).data()
    print(f"  {len(adj_edges)} adjuster edges")

    driver.close()
    return nodes, bank_edges + adj_edges


# ---------------------------------------------------------------------------
# 2. BUILD PyG GRAPH
# ---------------------------------------------------------------------------

def build_graph(nodes: list[dict], edges: list[dict]):
    # Build claim_id -> index mapping
    claim_ids = [n["claim_id"] for n in nodes]
    id_to_idx = {cid: i for i, cid in enumerate(claim_ids)}

    # Node features
    def encode_type(t):
        return [int(t == "AUTO"), int(t == "HOME"), int(t == "HEALTH")]

    def encode_channel(c):
        return [int(c == "WEB"), int(c == "PHONE"), int(c == "AGENT")]

    features = []
    labels = []

    for n in nodes:
        amt      = float(n["claim_amount"] or 0)
        days     = float(n["days_to_file"] or 0)
        approved = float(n["approved_amount"] or 0)
        bank_cnt = float(n["bank_claim_count"] or 0)
        adj_cnt  = float(n["adjuster_claim_count"] or 0)
        ph_cnt   = float(n["ph_claim_count"] or 0)
        law_firm = float(n["has_law_firm"] or 0)
        ratio    = (approved / amt) if amt > 0 else 0.0

        feat = [
            np.log1p(amt),          # log claim amount
            days / 30.0,            # normalized days to file
            ratio,                  # approved ratio
            min(bank_cnt, 30) / 30, # normalized bank sharing
            min(adj_cnt, 200) / 200,# normalized adjuster volume
            min(ph_cnt, 20) / 20,   # normalized policyholder claims
            law_firm,               # has law firm
            float(days <= 2),       # fast filer flag
            float(amt > 15000),     # high value flag
            float(bank_cnt >= 3),   # shared bank flag
        ] + encode_type(n["claim_type"]) + encode_channel(n["submission_channel"])

        features.append(feat)
        labels.append(int(n["label_is_fraud"] or 0))

    x = torch.tensor(features, dtype=torch.float)
    y = torch.tensor(labels, dtype=torch.long)

    # Build edge index
    src_list, dst_list = [], []
    for e in edges:
        s_idx = id_to_idx.get(e["src"])
        d_idx = id_to_idx.get(e["dst"])
        if s_idx is not None and d_idx is not None:
            src_list.append(s_idx)
            dst_list.append(d_idx)
            # undirected — add both directions
            src_list.append(d_idx)
            dst_list.append(s_idx)

    if src_list:
        edge_index = torch.tensor([src_list, dst_list], dtype=torch.long)
    else:
        edge_index = torch.zeros((2, 0), dtype=torch.long)

    print(f"\nGraph built: {x.shape[0]} nodes, {edge_index.shape[1]} edges, {x.shape[1]} features")
    print(f"Fraud rate: {y.sum().item()}/{len(y)} ({100*y.sum().item()/len(y):.1f}%)")

    data = Data(x=x, edge_index=edge_index, y=y)
    return data, claim_ids, id_to_idx


# ---------------------------------------------------------------------------
# 3. GRAPHSAGE MODEL
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# 4. TRAIN
# ---------------------------------------------------------------------------

def train_model(data: Data):
    n = data.num_nodes
    indices = list(range(n))
    train_idx, test_idx = train_test_split(
        indices, test_size=0.2, random_state=42,
        stratify=data.y.numpy()
    )

    train_mask = torch.zeros(n, dtype=torch.bool)
    test_mask  = torch.zeros(n, dtype=torch.bool)
    train_mask[train_idx] = True
    test_mask[test_idx]   = True

    # Class weights for imbalance
    fraud_count = data.y.sum().item()
    legit_count = n - fraud_count
    weight = torch.tensor([1.0, legit_count / fraud_count], dtype=torch.float)

    model = FraudGraphSAGE(in_channels=data.num_node_features)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.005, weight_decay=5e-4)
    criterion = torch.nn.CrossEntropyLoss(weight=weight)

    print("\nTraining GraphSAGE...")
    model.train()
    best_auc = 0
    best_state = None

    for epoch in range(1, 101):
        optimizer.zero_grad()
        out = model(data.x, data.edge_index)
        loss = criterion(out[train_mask], data.y[train_mask])
        loss.backward()
        optimizer.step()

        if epoch % 10 == 0:
            model.eval()
            with torch.no_grad():
                out = model(data.x, data.edge_index)
                probs = F.softmax(out, dim=1)[:, 1]
                test_probs = probs[test_mask].numpy()
                test_labels = data.y[test_mask].numpy()
                auc = roc_auc_score(test_labels, test_probs)
                if auc > best_auc:
                    best_auc = auc
                    best_state = {k: v.clone() for k, v in model.state_dict().items()}
                print(f"  Epoch {epoch:3d} | Loss: {loss.item():.4f} | AUC: {auc:.4f}")
            model.train()

    # Load best model
    model.load_state_dict(best_state)
    model.eval()

    with torch.no_grad():
        out = model(data.x, data.edge_index)
        probs = F.softmax(out, dim=1)[:, 1]
        test_probs = probs[test_mask].numpy()
        test_labels = data.y[test_mask].numpy()
        test_preds = (test_probs >= 0.5).astype(int)

    print(f"\n--- Best Model Evaluation ---")
    print(f"AUC-ROC: {best_auc:.4f}")
    print("\nClassification Report:")
    print(classification_report(test_labels, test_preds, target_names=["Legit", "Fraud"]))

    return model


# ---------------------------------------------------------------------------
# 5. SAVE
# ---------------------------------------------------------------------------

def save(model: FraudGraphSAGE, claim_ids: list[str], id_to_idx: dict, n_features: int):
    os.makedirs(MODEL_DIR, exist_ok=True)

    model_path = os.path.join(MODEL_DIR, "gnn_model.pt")
    meta_path  = os.path.join(MODEL_DIR, "gnn_meta.json")

    torch.save(model.state_dict(), model_path)

    with open(meta_path, "w") as f:
        json.dump({
            "claim_ids":  claim_ids,
            "id_to_idx":  id_to_idx,
            "n_features": n_features,
        }, f)

    print(f"\n✅ GNN model saved to {model_path}")
    print(f"✅ GNN metadata saved to {meta_path}")


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    nodes, edges = extract_graph()
    data, claim_ids, id_to_idx = build_graph(nodes, edges)
    model = train_model(data)
    save(model, claim_ids, id_to_idx, data.num_node_features)
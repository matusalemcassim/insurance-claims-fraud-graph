from collections import Counter
from app.db.neo4j import get_driver
from neo4j.time import Date, DateTime, Duration, Time
import math

# Maps node label to its ID property name
LABEL_TO_ID_PROP = {
    "Claim":        "claim_id",
    "PolicyHolder": "policyholder_id",
    "Policy":       "policy_id",
    "BankAccount":  "bank_account_id",
    "Provider":     "provider_id",
    "Vehicle":      "vehicle_id",
    "Adjuster":     "adjuster_id",
}

def _node_id(n) -> str:
    """
    Resolve a node's display ID using its label-specific ID property.
    Falls back to element_id to avoid cross-label ID collisions
    (e.g. a Document node that stores claim_id as a reference field).
    """
    label = list(n.labels)[0] if n.labels else None
    if label and label in LABEL_TO_ID_PROP:
        id_prop = LABEL_TO_ID_PROP[label]
        val = n.get(id_prop)
        if val:
            return str(val)
    # For unknown labels (Document, Address, etc.) use element_id
    # so they never collide with known-label node IDs
    return f"{label or 'Node'}:{n.element_id}"


def _node_properties(n) -> dict:
    result = {}
    for k, v in dict(n).items():
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            result[k] = None
        elif isinstance(v, (Date, DateTime, Time)):
            result[k] = str(v)
        elif isinstance(v, Duration):
            result[k] = str(v)
        else:
            result[k] = v
    return result


def get_neighborhood(node_id: str, node_label: str, depth: int = 2):
    driver = get_driver()
    depth = max(1, min(int(depth), 5))

    if node_label not in LABEL_TO_ID_PROP:
        return {"nodes": [], "edges": [], "error": f"Unknown node label: {node_label}"}

    id_prop = LABEL_TO_ID_PROP[node_label]

    query = f"""
    MATCH (c:{node_label} {{{id_prop}: $node_id}})
    MATCH p = (c)-[*1..{depth}]-(n)
    WITH collect(p) AS paths
    WITH
      reduce(ns = [], p IN paths | ns + nodes(p)) AS allNodes,
      reduce(rs = [], p IN paths | rs + relationships(p)) AS allRels
    UNWIND allNodes AS n
    WITH collect(DISTINCT n) AS nodes, allRels
    UNWIND allRels AS r
    WITH nodes, collect(DISTINCT r) AS rels
    RETURN nodes, rels
    """

    with driver.session() as session:
        record = session.run(query, node_id=node_id).single()
        if not record:
            return {"nodes": [], "edges": []}

        nodes = []
        for n in record["nodes"]:
            nodes.append({
                "id":         _node_id(n),
                "label":      list(n.labels)[0] if n.labels else "Node",
                "properties": _node_properties(n),
            })

        edges = []
        for r in record["rels"]:
            edges.append({
                "source": _node_id(r.start_node),
                "target": _node_id(r.end_node),
                "type":   r.type,
            })

        # --- Hub filtering ---
        edge_counts = Counter()
        for e in edges:
            edge_counts[e["source"]] += 1
            edge_counts[e["target"]] += 1

        MAX_DEGREE = 50
        hub_ids = {nid for nid, count in edge_counts.items() if count > MAX_DEGREE}
        direct_neighbors  = {e["source"] for e in edges if e["target"] == node_id}
        direct_neighbors |= {e["target"] for e in edges if e["source"] == node_id}

        nodes = [
            {**n, "is_hub": n["id"] in hub_ids}
            for n in nodes
            if n["id"] not in hub_ids
            or n["id"] == node_id
            or n["id"] in direct_neighbors
        ]
        edges = [
            e for e in edges
            if (e["source"] not in hub_ids or e["source"] in direct_neighbors)
            and (e["target"] not in hub_ids or e["target"] in direct_neighbors)
        ]
        # --- End hub filtering ---

        return {"nodes": nodes, "edges": edges}


def get_claim_neighborhood(claim_id: str, depth: int = 2):
    return get_neighborhood(claim_id, "Claim", depth)
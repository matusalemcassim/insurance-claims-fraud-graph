LOAD CSV WITH HEADERS FROM 'file:///policies.csv' AS row
MERGE (po:Policy {policy_id: row.policy_id})
SET po.policy_type = row.policy_type,
    po.start_date = date(row.start_date),
    po.end_date = date(row.end_date),
    po.premium_monthly = toFloat(row.premium_monthly),
    po.coverage_limit = toFloat(row.coverage_limit),
    po.deductible = toFloat(row.deductible),
    po.status = row.status
WITH po, row
MATCH (p:PolicyHolder {policyholder_id: row.policyholder_id})
MERGE (p)-[:HAS_POLICY]->(po);

LOAD CSV WITH HEADERS FROM 'file:///claims.csv' AS row
MERGE (c:Claim {claim_id: row.claim_id})
SET c.claim_type = row.claim_type,
    c.incident_date = date(row.incident_date),
    c.filed_date = date(row.filed_date),
    c.days_to_file = toInteger(row.days_to_file),
    c.claim_amount = toFloat(row.claim_amount),
    c.approved_amount = toFloat(row.approved_amount),
    c.status = row.status,
    c.description = row.description,
    c.submission_channel = row.submission_channel,
    c.ip_hash = row.ip_hash,
    c.device_hash = row.device_hash,
    c.label_is_fraud = toInteger(row.label_is_fraud),
    c.fraud_scenario = row.fraud_scenario
WITH c, row
MATCH (po:Policy {policy_id: row.policy_id})
MERGE (po)-[:HAS_CLAIM]->(c)
WITH c, row
MATCH (b:BankAccount {bank_account_id: row.payout_bank_account_id})
MERGE (c)-[:PAID_TO]->(b)
WITH c, row
MATCH (aj:Adjuster {adjuster_id: row.adjuster_id})
MERGE (c)-[:HANDLED_BY]->(aj)
WITH c, row
// Optional relationships using FOREACH trick
FOREACH (_ IN CASE WHEN row.vehicle_id <> '' THEN [1] ELSE [] END |
  MATCH (v:Vehicle {vehicle_id: row.vehicle_id})
  MERGE (c)-[:INVOLVES_VEHICLE]->(v)
)
FOREACH (_ IN CASE WHEN row.provider_id <> '' THEN [1] ELSE [] END |
  MATCH (pr:Provider {provider_id: row.provider_id})
  MERGE (c)-[:TREATED_BY]->(pr)
)
FOREACH (_ IN CASE WHEN row.shop_id <> '' THEN [1] ELSE [] END |
  MATCH (s:RepairShop {shop_id: row.shop_id})
  MERGE (c)-[:REPAIRED_BY]->(s)
)
FOREACH (_ IN CASE WHEN row.law_firm_id <> '' THEN [1] ELSE [] END |
  MATCH (lf:LawFirm {law_firm_id: row.law_firm_id})
  MERGE (c)-[:REPRESENTED_BY]->(lf)
);

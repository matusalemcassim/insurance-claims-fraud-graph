LOAD CSV WITH HEADERS FROM 'file:///policyholders.csv' AS row
MERGE (p:PolicyHolder {policyholder_id: row.policyholder_id})
SET p.full_name = row.full_name,
    p.dob = date(row.dob),
    p.ssn_hash = row.ssn_hash,
    p.phone = row.phone,
    p.email = row.email,
    p.created_at = datetime(row.created_at)
WITH p, row
MATCH (a:Address {address_id: row.address_id})
MERGE (p)-[:LIVES_AT]->(a);

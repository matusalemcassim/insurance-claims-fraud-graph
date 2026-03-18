// Q1: Bank account rings (many policyholders paid to same account)
MATCH (c:Claim)-[:PAID_TO]->(b:BankAccount)
MATCH (p:PolicyHolder)-[:HAS_POLICY]->(:Policy)-[:HAS_CLAIM]->(c)
WITH b, collect(DISTINCT p.policyholder_id) AS holders, count(DISTINCT c) AS claims
WHERE size(holders) >= 3
RETURN b.bank_account_id AS bank_account, size(holders) AS distinct_policyholders, claims
ORDER BY distinct_policyholders DESC, claims DESC;

// Q2: Shared address clusters
MATCH (p:PolicyHolder)-[:LIVES_AT]->(a:Address)
WITH a, collect(p.policyholder_id) AS holders
WHERE size(holders) >= 5
RETURN a.address_id, size(holders) AS policyholders, holders[0..10] AS sample_holders
ORDER BY policyholders DESC;

// Q3: Provider hubs
MATCH (c:Claim)-[:TREATED_BY]->(pr:Provider)
MATCH (p:PolicyHolder)-[:HAS_POLICY]->(:Policy)-[:HAS_CLAIM]->(c)
WITH pr, count(DISTINCT p) AS claimants, count(c) AS claims,
     avg(c.claim_amount) AS avg_claim, avg(c.approved_amount) AS avg_approved
WHERE claimants >= 10
RETURN pr.provider_id, claimants, claims, avg_claim, avg_approved
ORDER BY claimants DESC, avg_approved DESC;

// Q4: Repeated triangle law firm + provider
MATCH (p:PolicyHolder)-[:HAS_POLICY]->(:Policy)-[:HAS_CLAIM]->(c:Claim)
MATCH (c)-[:REPRESENTED_BY]->(lf:LawFirm)
MATCH (c)-[:TREATED_BY]->(pr:Provider)
WITH lf, pr, count(DISTINCT p) AS claimants, count(c) AS claims
WHERE claimants >= 5 AND claims >= 8
RETURN lf.law_firm_id, pr.provider_id, claimants, claims
ORDER BY claims DESC;

// Q5: Look at fraud labels to sanity-check injection
MATCH (c:Claim)
WHERE c.label_is_fraud = 1
RETURN c.fraud_scenario AS scenario, count(*) AS n
ORDER BY n DESC;

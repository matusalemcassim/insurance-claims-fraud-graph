// Bank accounts
LOAD CSV WITH HEADERS FROM 'file:///bank_accounts.csv' AS row
MERGE (b:BankAccount {bank_account_id: row.bank_account_id})
SET b.account_hash = row.account_hash,
    b.bank_name = row.bank_name;

// Providers
LOAD CSV WITH HEADERS FROM 'file:///providers.csv' AS row
MERGE (pr:Provider {provider_id: row.provider_id})
SET pr.provider_name = row.provider_name,
    pr.provider_type = row.provider_type,
    pr.npi_hash = row.npi_hash
WITH pr, row
MATCH (a:Address {address_id: row.address_id})
MERGE (pr)-[:LOCATED_AT]->(a);

// Repair shops
LOAD CSV WITH HEADERS FROM 'file:///repair_shops.csv' AS row
MERGE (s:RepairShop {shop_id: row.shop_id})
SET s.shop_name = row.shop_name,
    s.phone = row.phone
WITH s, row
MATCH (a:Address {address_id: row.address_id})
MERGE (s)-[:LOCATED_AT]->(a);

// Law firms
LOAD CSV WITH HEADERS FROM 'file:///law_firms.csv' AS row
MERGE (lf:LawFirm {law_firm_id: row.law_firm_id})
SET lf.law_firm_name = row.law_firm_name
WITH lf, row
MATCH (a:Address {address_id: row.address_id})
MERGE (lf)-[:LOCATED_AT]->(a);

// Adjusters
LOAD CSV WITH HEADERS FROM 'file:///adjusters.csv' AS row
MERGE (aj:Adjuster {adjuster_id: row.adjuster_id})
SET aj.adjuster_name = row.adjuster_name,
    aj.region = row.region;

// Vehicles
LOAD CSV WITH HEADERS FROM 'file:///vehicles.csv' AS row
MERGE (v:Vehicle {vehicle_id: row.vehicle_id})
SET v.vin_hash = row.vin_hash,
    v.make = row.make,
    v.model = row.model,
    v.year = toInteger(row.year);

from __future__ import annotations
import os
from pathlib import Path
import pandas as pd
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")

def _read_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path)

def load_all(data_dir: str = "data/raw"):
    data_path = Path(data_dir)

    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    driver.verify_connectivity()

    with driver.session() as s:
        constraints = [
            "CREATE CONSTRAINT address_id IF NOT EXISTS FOR (n:Address) REQUIRE n.address_id IS UNIQUE",
            "CREATE CONSTRAINT policyholder_id IF NOT EXISTS FOR (n:PolicyHolder) REQUIRE n.policyholder_id IS UNIQUE",
            "CREATE CONSTRAINT policy_id IF NOT EXISTS FOR (n:Policy) REQUIRE n.policy_id IS UNIQUE",
            "CREATE CONSTRAINT claim_id IF NOT EXISTS FOR (n:Claim) REQUIRE n.claim_id IS UNIQUE",
            "CREATE CONSTRAINT bank_account_id IF NOT EXISTS FOR (n:BankAccount) REQUIRE n.bank_account_id IS UNIQUE",
            "CREATE CONSTRAINT provider_id IF NOT EXISTS FOR (n:Provider) REQUIRE n.provider_id IS UNIQUE",
            "CREATE CONSTRAINT shop_id IF NOT EXISTS FOR (n:RepairShop) REQUIRE n.shop_id IS UNIQUE",
            "CREATE CONSTRAINT law_firm_id IF NOT EXISTS FOR (n:LawFirm) REQUIRE n.law_firm_id IS UNIQUE",
            "CREATE CONSTRAINT adjuster_id IF NOT EXISTS FOR (n:Adjuster) REQUIRE n.adjuster_id IS UNIQUE",
            "CREATE CONSTRAINT vehicle_id IF NOT EXISTS FOR (n:Vehicle) REQUIRE n.vehicle_id IS UNIQUE",
        ]
        for q in constraints:
            s.run(q).consume()


    def write_rows(query: str, rows: list[dict]):
        with driver.session() as s:
            s.execute_write(lambda tx: tx.run(query, rows=rows).consume())

    # Addresses
    df = _read_csv(data_path / "addresses.csv")
    write_rows("""
    UNWIND $rows AS row
    MERGE (a:Address {address_id: row.address_id})
    SET a.street = row.street, a.city = row.city, a.state = row.state, a.zip = row.zip,
        a.latitude = toFloat(row.latitude), a.longitude = toFloat(row.longitude);
    """, df.to_dict("records"))

    # Policyholders + lives at
    df = _read_csv(data_path / "policyholders.csv")
    write_rows("""
    UNWIND $rows AS row
    MERGE (p:PolicyHolder {policyholder_id: row.policyholder_id})
    SET p.full_name = row.full_name, p.dob = date(row.dob), p.ssn_hash = row.ssn_hash,
        p.phone = row.phone, p.email = row.email, p.created_at = datetime(row.created_at)
    WITH p, row
    MATCH (a:Address {address_id: row.address_id})
    MERGE (p)-[:LIVES_AT]->(a);
    """, df.to_dict("records"))

    # Policies
    df = _read_csv(data_path / "policies.csv")
    write_rows("""
    UNWIND $rows AS row
    MERGE (po:Policy {policy_id: row.policy_id})
    SET po.policy_type = row.policy_type, po.start_date = date(row.start_date), po.end_date = date(row.end_date),
        po.premium_monthly = toFloat(row.premium_monthly), po.coverage_limit = toFloat(row.coverage_limit),
        po.deductible = toFloat(row.deductible), po.status = row.status
    WITH po, row
    MATCH (p:PolicyHolder {policyholder_id: row.policyholder_id})
    MERGE (p)-[:HAS_POLICY]->(po);
    """, df.to_dict("records"))

    # Entities: bank, providers, shops, law, adjusters, vehicles
    df = _read_csv(data_path / "bank_accounts.csv")
    write_rows("""
    UNWIND $rows AS row
    MERGE (b:BankAccount {bank_account_id: row.bank_account_id})
    SET b.account_hash = row.account_hash, b.bank_name = row.bank_name;
    """, df.to_dict("records"))

    df = _read_csv(data_path / "providers.csv")
    write_rows("""
    UNWIND $rows AS row
    MERGE (pr:Provider {provider_id: row.provider_id})
    SET pr.provider_name = row.provider_name, pr.provider_type = row.provider_type, pr.npi_hash = row.npi_hash
    WITH pr, row
    MATCH (a:Address {address_id: row.address_id})
    MERGE (pr)-[:LOCATED_AT]->(a);
    """, df.to_dict("records"))

    df = _read_csv(data_path / "repair_shops.csv")
    write_rows("""
    UNWIND $rows AS row
    MERGE (s:RepairShop {shop_id: row.shop_id})
    SET s.shop_name = row.shop_name, s.phone = row.phone
    WITH s, row
    MATCH (a:Address {address_id: row.address_id})
    MERGE (s)-[:LOCATED_AT]->(a);
    """, df.to_dict("records"))

    df = _read_csv(data_path / "law_firms.csv")
    write_rows("""
    UNWIND $rows AS row
    MERGE (lf:LawFirm {law_firm_id: row.law_firm_id})
    SET lf.law_firm_name = row.law_firm_name
    WITH lf, row
    MATCH (a:Address {address_id: row.address_id})
    MERGE (lf)-[:LOCATED_AT]->(a);
    """, df.to_dict("records"))

    df = _read_csv(data_path / "adjusters.csv")
    write_rows("""
    UNWIND $rows AS row
    MERGE (aj:Adjuster {adjuster_id: row.adjuster_id})
    SET aj.adjuster_name = row.adjuster_name, aj.region = row.region;
    """, df.to_dict("records"))

    df = _read_csv(data_path / "vehicles.csv")
    write_rows("""
    UNWIND $rows AS row
    MERGE (v:Vehicle {vehicle_id: row.vehicle_id})
    SET v.vin_hash = row.vin_hash, v.make = row.make, v.model = row.model, v.year = toInteger(row.year);
    """, df.to_dict("records"))

    # Claims + relationships
    df = _read_csv(data_path / "claims.csv")
    write_rows("""
    UNWIND $rows AS row
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

    // OPTIONAL entity matches (must be OUTSIDE foreach)
    OPTIONAL MATCH (v:Vehicle {vehicle_id: row.vehicle_id})
    OPTIONAL MATCH (pr:Provider {provider_id: row.provider_id})
    OPTIONAL MATCH (s:RepairShop {shop_id: row.shop_id})
    OPTIONAL MATCH (lf:LawFirm {law_firm_id: row.law_firm_id})

    FOREACH (_ IN CASE WHEN v  IS NULL THEN [] ELSE [1] END |
    MERGE (c)-[:INVOLVES_VEHICLE]->(v)
    )
    FOREACH (_ IN CASE WHEN pr IS NULL THEN [] ELSE [1] END |
    MERGE (c)-[:TREATED_BY]->(pr)
    )
    FOREACH (_ IN CASE WHEN s  IS NULL THEN [] ELSE [1] END |
    MERGE (c)-[:REPAIRED_BY]->(s)
    )
    FOREACH (_ IN CASE WHEN lf IS NULL THEN [] ELSE [1] END |
    MERGE (c)-[:REPRESENTED_BY]->(lf)
    );
    """, df.to_dict("records"))

    driver.close()
    print("✅ Loaded all data into Neo4j successfully.")

if __name__ == "__main__":
    main()
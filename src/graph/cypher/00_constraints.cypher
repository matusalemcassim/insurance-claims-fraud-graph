CREATE CONSTRAINT address_id IF NOT EXISTS
FOR (n:Address) REQUIRE n.address_id IS UNIQUE;

CREATE CONSTRAINT policyholder_id IF NOT EXISTS
FOR (n:PolicyHolder) REQUIRE n.policyholder_id IS UNIQUE;

CREATE CONSTRAINT policy_id IF NOT EXISTS
FOR (n:Policy) REQUIRE n.policy_id IS UNIQUE;

CREATE CONSTRAINT claim_id IF NOT EXISTS
FOR (n:Claim) REQUIRE n.claim_id IS UNIQUE;

CREATE CONSTRAINT bank_account_id IF NOT EXISTS
FOR (n:BankAccount) REQUIRE n.bank_account_id IS UNIQUE;

CREATE CONSTRAINT provider_id IF NOT EXISTS
FOR (n:Provider) REQUIRE n.provider_id IS UNIQUE;

CREATE CONSTRAINT shop_id IF NOT EXISTS
FOR (n:RepairShop) REQUIRE n.shop_id IS UNIQUE;

CREATE CONSTRAINT law_firm_id IF NOT EXISTS
FOR (n:LawFirm) REQUIRE n.law_firm_id IS UNIQUE;

CREATE CONSTRAINT adjuster_id IF NOT EXISTS
FOR (n:Adjuster) REQUIRE n.adjuster_id IS UNIQUE;

CREATE CONSTRAINT vehicle_id IF NOT EXISTS
FOR (n:Vehicle) REQUIRE n.vehicle_id IS UNIQUE;

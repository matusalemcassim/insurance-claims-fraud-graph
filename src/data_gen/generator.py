from __future__ import annotations

import random
import hashlib
from dataclasses import dataclass
from datetime import date, timedelta

import pandas as pd
from faker import Faker

from .fraud_injection import (
    inject_shared_bank_account_ring,
    inject_shared_address_phone_cluster,
    inject_collusive_provider,
    inject_triangle_lawfirm_provider,
    inject_rapid_reclaim_burst,
    inject_inflated_repair_shop,
    inject_adjuster_collusion,
    inject_phantom_policy,
)

fake = Faker("en_US")


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:24]


def _rand_date(start: date, end: date) -> date:
    days = (end - start).days
    return start + timedelta(days=random.randint(0, max(days, 0)))


@dataclass
class GenConfig:
    seed: int = 42
    n_policyholders: int = 2500
    n_addresses: int = 1800
    n_policies: int = 2600
    n_claims: int = 9000
    n_bank_accounts: int = 2200
    n_providers: int = 250
    n_shops: int = 180
    n_law_firms: int = 60
    n_adjusters: int = 50
    n_vehicles: int = 2200


def generate_all(cfg: GenConfig) -> dict[str, pd.DataFrame]:
    random.seed(cfg.seed)
    Faker.seed(cfg.seed)

    # ---------------------------
    # ADDRESSES
    # ---------------------------
    addresses = []
    for i in range(cfg.n_addresses):
        aid = f"AD{i:06d}"
        addresses.append({
            "address_id": aid,
            "street": fake.street_address(),
            "city": fake.city(),
            "state": fake.state_abbr(),
            "zip": fake.postcode(),
            "latitude": float(fake.latitude()),
            "longitude": float(fake.longitude()),
        })
    df_addresses = pd.DataFrame(addresses)

    # ---------------------------
    # BANK ACCOUNTS
    # ---------------------------
    banks = ["Chase", "Bank of America", "Wells Fargo", "Citibank", "Capital One", "TD Bank", "PNC"]
    bank_accounts = []
    for i in range(cfg.n_bank_accounts):
        bid = f"BA{i:06d}"
        bank_accounts.append({
            "bank_account_id": bid,
            "account_hash": _hash(fake.iban() + fake.swift11()),
            "bank_name": random.choice(banks),
        })
    df_bank = pd.DataFrame(bank_accounts)

    # ---------------------------
    # PROVIDERS (HEALTH)
    # ---------------------------
    provider_types = ["CLINIC", "HOSPITAL", "PT"]
    providers = []
    for i in range(cfg.n_providers):
        pid = f"PR{i:06d}"
        providers.append({
            "provider_id": pid,
            "provider_name": f"{fake.company()} {random.choice(['Clinic','Health','Care','Medical'])}",
            "provider_type": random.choice(provider_types),
            "npi_hash": _hash(str(fake.random_number(digits=10, fix_len=True))),
            "address_id": random.choice(df_addresses["address_id"].tolist()),
        })
    df_providers = pd.DataFrame(providers)

    # ---------------------------
    # REPAIR SHOPS (AUTO)
    # ---------------------------
    shops = []
    for i in range(cfg.n_shops):
        sid = f"RS{i:06d}"
        shops.append({
            "shop_id": sid,
            "shop_name": f"{fake.company()} Body Shop",
            "address_id": random.choice(df_addresses["address_id"].tolist()),
            "phone": fake.phone_number(),
        })
    df_shops = pd.DataFrame(shops)

    # ---------------------------
    # LAW FIRMS
    # ---------------------------
    law_firms = []
    for i in range(cfg.n_law_firms):
        lid = f"LF{i:06d}"
        law_firms.append({
            "law_firm_id": lid,
            "law_firm_name": f"{fake.last_name()} & {fake.last_name()} LLP",
            "address_id": random.choice(df_addresses["address_id"].tolist()),
        })
    df_law = pd.DataFrame(law_firms)

    # ---------------------------
    # ADJUSTERS
    # ---------------------------
    adjusters = []
    for i in range(cfg.n_adjusters):
        aj = f"AJ{i:06d}"
        adjusters.append({
            "adjuster_id": aj,
            "adjuster_name": fake.name(),
            "region": random.choice(["CT", "MA", "RI", "NY"]),
        })
    df_adj = pd.DataFrame(adjusters)

    # ---------------------------
    # VEHICLES
    # ---------------------------
    makes_models = [
        ("Toyota", "Corolla"), ("Honda", "Civic"), ("Ford", "Escape"),
        ("Chevrolet", "Malibu"), ("Nissan", "Sentra"),
        ("Hyundai", "Elantra"), ("Kia", "Sportage"),
    ]
    vehicles = []
    for i in range(cfg.n_vehicles):
        vid = f"VE{i:06d}"
        mk, md = random.choice(makes_models)
        vehicles.append({
            "vehicle_id": vid,
            "vin_hash": _hash(fake.vin()),
            "make": mk,
            "model": md,
            "year": random.randint(2008, 2025),
        })
    df_veh = pd.DataFrame(vehicles)

    # ---------------------------
    # POLICYHOLDERS
    # ---------------------------
    policyholders = []
    for i in range(cfg.n_policyholders):
        pid = f"PH{i:06d}"
        policyholders.append({
            "policyholder_id": pid,
            "full_name": fake.name(),
            "dob": fake.date_of_birth(minimum_age=18, maximum_age=80).isoformat(),
            "ssn_hash": _hash(fake.ssn()),
            "phone": fake.phone_number(),
            "email": fake.email(),
            "address_id": random.choice(df_addresses["address_id"].tolist()),
            "created_at": fake.date_time_between(start_date="-2y", end_date="now").isoformat(),
        })
    df_ph = pd.DataFrame(policyholders)

    # ---------------------------
    # POLICIES
    # ---------------------------
    policy_types = ["AUTO", "HOME", "HEALTH"]
    policies = []
    for i in range(cfg.n_policies):
        po = f"PO{i:06d}"
        holder = random.choice(df_ph["policyholder_id"].tolist())
        ptype = random.choices(policy_types, weights=[0.55, 0.2, 0.25])[0]
        s = _rand_date(date(2024, 1, 1), date(2025, 12, 1))
        e = s + timedelta(days=random.choice([180, 365]))
        policies.append({
            "policy_id": po,
            "policyholder_id": holder,
            "policy_type": ptype,
            "start_date": s.isoformat(),
            "end_date": e.isoformat(),
            "premium_monthly": round(random.uniform(60, 420), 2),
            "coverage_limit": float(random.choice([25000, 50000, 100000, 250000])),
            "deductible": float(random.choice([250, 500, 1000, 2000])),
            "status": random.choices(["ACTIVE", "LAPSED"], weights=[0.92, 0.08])[0],
        })
    df_pol = pd.DataFrame(policies)

    policy_to_holder = dict(zip(df_pol["policy_id"], df_pol["policyholder_id"]))

    # ---------------------------
    # CLAIMS
    # ---------------------------
    claim_statuses = ["APPROVED", "DENIED", "PENDING"]
    channels = ["WEB", "PHONE", "AGENT"]

    claims = []
    for i in range(cfg.n_claims):
        cid = f"CL{i:07d}"
        policy_id = random.choice(df_pol["policy_id"].tolist())
        holder_id = policy_to_holder[policy_id]
        ptype = df_pol.loc[df_pol["policy_id"] == policy_id, "policy_type"].iloc[0]

        incident = _rand_date(date(2024, 1, 1), date(2025, 12, 31))
        days_to_file = random.choices([0, 1, 2, 3, 5, 7, 14], weights=[2, 6, 10, 12, 18, 22, 30])[0]
        filed = incident + timedelta(days=days_to_file)

        base_amt = {
            "AUTO": random.uniform(800, 22000),
            "HOME": random.uniform(500, 35000),
            "HEALTH": random.uniform(200, 18000),
        }[ptype]
        claim_amount = round(base_amt, 2)

        approved_ratio = random.uniform(0.4, 0.95)
        approved_amount = round(claim_amount * approved_ratio, 2)

        vehicle_id = random.choice(df_veh["vehicle_id"].tolist()) if ptype == "AUTO" else ""
        shop_id = random.choice(df_shops["shop_id"].tolist()) if ptype == "AUTO" else ""
        provider_id = random.choice(df_providers["provider_id"].tolist()) if ptype == "HEALTH" else ""
        law_firm_id = random.choice(df_law["law_firm_id"].tolist()) if random.random() < 0.15 else ""
        adjuster_id = random.choice(df_adj["adjuster_id"].tolist())
        payout_bank_account_id = random.choice(df_bank["bank_account_id"].tolist())

        claims.append({
            "claim_id": cid,
            "policy_id": policy_id,
            "policyholder_id": holder_id,
            "claim_type": ptype,
            "incident_date": incident.isoformat(),
            "filed_date": filed.isoformat(),
            "days_to_file": days_to_file,
            "claim_amount": claim_amount,
            "approved_amount": approved_amount,
            "status": random.choices(claim_statuses, weights=[0.68, 0.12, 0.20])[0],
            "description": fake.sentence(nb_words=12),
            "vehicle_id": vehicle_id or "",
            "provider_id": provider_id or "",
            "shop_id": shop_id or "",
            "law_firm_id": law_firm_id or "",
            "adjuster_id": adjuster_id,
            "payout_bank_account_id": payout_bank_account_id,
            "submission_channel": random.choice(channels),
            "ip_hash": _hash(fake.ipv4()),
            "device_hash": _hash(fake.mac_address()),
            "label_is_fraud": 0,
            "fraud_scenario": "",
        })

    df_claims = pd.DataFrame(claims)

    # ---------------------------
    # FRAUD INJECTION — 8 scenarios targeting ~25% fraud rate
    # ---------------------------
    df_claims = inject_shared_bank_account_ring(df_claims, n_rings=12, ring_size=25)
    df_claims, df_ph = inject_shared_address_phone_cluster(df_claims, df_ph, n_clusters=8, cluster_holders=12)
    df_claims = inject_collusive_provider(df_claims, n_providers=6, ring_size=20)
    df_claims = inject_triangle_lawfirm_provider(df_claims, n_triangles=5, ring_size=18)
    df_claims = inject_rapid_reclaim_burst(df_claims, n_policyholders=40, claims_per_holder=5)
    df_claims = inject_inflated_repair_shop(df_claims, n_shops=4, ring_size=20)
    df_claims = inject_adjuster_collusion(df_claims, n_adjusters=3, ring_size=30)
    df_claims = inject_phantom_policy(df_claims, n_clusters=5, ring_size=15)

    fraud_count = df_claims["label_is_fraud"].sum()
    total = len(df_claims)
    print(f"✅ Fraud injection complete: {fraud_count}/{total} fraud claims ({100*fraud_count/total:.1f}%)")
    print(df_claims.groupby("fraud_scenario")["label_is_fraud"].count().to_string())

    # Ensure optional IDs are empty string
    for col in ["vehicle_id", "provider_id", "shop_id", "law_firm_id"]:
        df_claims[col] = df_claims[col].fillna("")

    return {
        "addresses": df_addresses,
        "bank_accounts": df_bank,
        "providers": df_providers,
        "repair_shops": df_shops,
        "law_firms": df_law,
        "adjusters": df_adj,
        "vehicles": df_veh,
        "policyholders": df_ph,
        "policies": df_pol,
        "claims": df_claims,
    }
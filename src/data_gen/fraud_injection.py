from __future__ import annotations
import random
import pandas as pd


# ---------------------------------------------------------------------------
# EXISTING SCENARIOS (scaled up significantly)
# ---------------------------------------------------------------------------

def inject_shared_bank_account_ring(
    df_claims: pd.DataFrame,
    n_rings: int = 12,
    ring_size: int = 25,
) -> pd.DataFrame:
    """
    Multiple independent rings, each funnelling payouts to a shared mule account.
    Scaled from 1 ring of 18 → 12 rings of 25 = ~300 fraud claims.
    """
    df = df_claims.copy()
    bank_pool = df["payout_bank_account_id"].dropna().unique().tolist()

    for _ in range(n_rings):
        candidates = df[df["label_is_fraud"] == 0]
        if len(candidates) < ring_size:
            break
        ring_idxs = candidates.sample(ring_size, replace=False).index
        ring_bank = random.choice(bank_pool)

        df.loc[ring_idxs, "payout_bank_account_id"] = ring_bank
        df.loc[ring_idxs, "label_is_fraud"] = 1
        df.loc[ring_idxs, "fraud_scenario"] = "shared_bank_account_ring"
        df.loc[ring_idxs, "days_to_file"] = df.loc[ring_idxs, "days_to_file"].clip(0, 2)
        df.loc[ring_idxs, "claim_amount"] = (df.loc[ring_idxs, "claim_amount"] * 1.3).round(2)

    return df


def inject_shared_address_phone_cluster(
    df_claims: pd.DataFrame,
    df_policyholders: pd.DataFrame,
    n_clusters: int = 8,
    cluster_holders: int = 12,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Synthetic identity cluster: multiple policyholders share address + phone.
    Scaled from 1 cluster of 10 → 8 clusters of 12 = ~96 fraud claims.
    """
    ph = df_policyholders.copy()
    cl = df_claims.copy()
    address_pool = ph["address_id"].dropna().unique().tolist()

    for _ in range(n_clusters):
        available = ph.sample(frac=1).index[:cluster_holders]
        shared_address = random.choice(address_pool)
        shared_phone = ph.loc[available[0], "phone"]

        ph.loc[available, "address_id"] = shared_address
        ph.loc[available, "phone"] = shared_phone

        holder_ids = ph.loc[available, "policyholder_id"].tolist()
        pool = cl[(cl["policyholder_id"].isin(holder_ids)) & (cl["label_is_fraud"] == 0)]
        n = min(16, len(pool))
        if n == 0:
            continue
        target = pool.sample(n, replace=False).index
        cl.loc[target, "label_is_fraud"] = 1
        cl.loc[target, "fraud_scenario"] = "shared_address_phone_cluster"

    return cl, ph


def inject_collusive_provider(
    df_claims: pd.DataFrame,
    n_providers: int = 6,
    ring_size: int = 20,
) -> pd.DataFrame:
    """
    Multiple colluding providers each processing fraudulent HEALTH claims.
    Scaled from 1 provider of 16 → 6 providers of 20 = ~120 fraud claims.
    """
    df = df_claims.copy()
    provider_pool = df["provider_id"].replace("", pd.NA).dropna().unique().tolist()

    for _ in range(n_providers):
        candidates = df[(df["claim_type"] == "HEALTH") & (df["label_is_fraud"] == 0)]
        if len(candidates) < ring_size:
            break
        ring_idxs = candidates.sample(ring_size, replace=False).index
        provider = random.choice(provider_pool)

        df.loc[ring_idxs, "provider_id"] = provider
        df.loc[ring_idxs, "label_is_fraud"] = 1
        df.loc[ring_idxs, "fraud_scenario"] = "collusive_provider"
        df.loc[ring_idxs, "approved_amount"] = (df.loc[ring_idxs, "claim_amount"] * 0.95).clip(0, None).round(2)

    return df


def inject_triangle_lawfirm_provider(
    df_claims: pd.DataFrame,
    n_triangles: int = 5,
    ring_size: int = 18,
) -> pd.DataFrame:
    """
    Repeated triangle: same law firm + same provider across HEALTH claims.
    Scaled from 1 triangle of 14 → 5 triangles of 18 = ~90 fraud claims.
    """
    df = df_claims.copy()
    lf_pool = df["law_firm_id"].replace("", pd.NA).dropna().unique().tolist()
    pr_pool = df["provider_id"].replace("", pd.NA).dropna().unique().tolist()

    for _ in range(n_triangles):
        candidates = df[
            (df["claim_type"] == "HEALTH") &
            (df["label_is_fraud"] == 0) &
            df["provider_id"].replace("", pd.NA).notna() &
            df["law_firm_id"].replace("", pd.NA).notna()
        ]
        if len(candidates) < ring_size:
            # relax constraint — allow any HEALTH claim
            candidates = df[(df["claim_type"] == "HEALTH") & (df["label_is_fraud"] == 0)]
        if len(candidates) < ring_size:
            break

        ring_idxs = candidates.sample(ring_size, replace=False).index
        lf = random.choice(lf_pool)
        pr = random.choice(pr_pool)

        df.loc[ring_idxs, "law_firm_id"] = lf
        df.loc[ring_idxs, "provider_id"] = pr
        df.loc[ring_idxs, "label_is_fraud"] = 1
        df.loc[ring_idxs, "fraud_scenario"] = "triangle_lawfirm_provider"
        df.loc[ring_idxs, "days_to_file"] = df.loc[ring_idxs, "days_to_file"].clip(0, 1)

    return df


# ---------------------------------------------------------------------------
# NEW SCENARIOS
# ---------------------------------------------------------------------------

def inject_rapid_reclaim_burst(
    df_claims: pd.DataFrame,
    n_policyholders: int = 40,
    claims_per_holder: int = 5,
) -> pd.DataFrame:
    """
    Same policyholder files multiple claims in a short burst.
    Simulates a policyholder systematically exploiting their policy.
    ~40 policyholders x 5 claims = ~200 fraud claims.
    """
    df = df_claims.copy()
    # find policyholders with enough claims to sample from
    counts = df[df["label_is_fraud"] == 0].groupby("policyholder_id").size()
    eligible = counts[counts >= claims_per_holder].index.tolist()

    if not eligible:
        return df

    chosen = random.sample(eligible, min(n_policyholders, len(eligible)))

    for ph_id in chosen:
        pool = df[(df["policyholder_id"] == ph_id) & (df["label_is_fraud"] == 0)]
        idxs = pool.sample(min(claims_per_holder, len(pool)), replace=False).index

        # compress filing dates to within 30 days of the first incident
        base_date = df.loc[idxs, "incident_date"].min()
        df.loc[idxs, "days_to_file"] = [random.randint(0, 3) for _ in idxs]
        df.loc[idxs, "label_is_fraud"] = 1
        df.loc[idxs, "fraud_scenario"] = "rapid_reclaim_burst"

    return df


def inject_inflated_repair_shop(
    df_claims: pd.DataFrame,
    n_shops: int = 4,
    ring_size: int = 20,
) -> pd.DataFrame:
    """
    Repair shop systematically inflates claim amounts on AUTO claims.
    ~4 shops x 20 claims = ~80 fraud claims.
    """
    df = df_claims.copy()
    shop_pool = df["shop_id"].replace("", pd.NA).dropna().unique().tolist()

    for _ in range(n_shops):
        candidates = df[(df["claim_type"] == "AUTO") & (df["label_is_fraud"] == 0)]
        if len(candidates) < ring_size or not shop_pool:
            break

        ring_idxs = candidates.sample(ring_size, replace=False).index
        shop = random.choice(shop_pool)

        df.loc[ring_idxs, "shop_id"] = shop
        df.loc[ring_idxs, "label_is_fraud"] = 1
        df.loc[ring_idxs, "fraud_scenario"] = "inflated_repair_shop"
        # shop bills ~2.5x the normal amount
        df.loc[ring_idxs, "claim_amount"] = (df.loc[ring_idxs, "claim_amount"] * 2.5).round(2)
        df.loc[ring_idxs, "approved_amount"] = (df.loc[ring_idxs, "claim_amount"] * 0.88).round(2)

    return df


def inject_adjuster_collusion(
    df_claims: pd.DataFrame,
    n_adjusters: int = 3,
    ring_size: int = 30,
) -> pd.DataFrame:
    """
    A corrupt adjuster approves an abnormal cluster of high-value claims.
    ~3 adjusters x 30 claims = ~90 fraud claims.
    """
    df = df_claims.copy()
    adjuster_pool = df["adjuster_id"].dropna().unique().tolist()

    for _ in range(n_adjusters):
        candidates = df[df["label_is_fraud"] == 0]
        if len(candidates) < ring_size or not adjuster_pool:
            break

        # prefer high-value claims
        high_value = candidates[candidates["claim_amount"] > candidates["claim_amount"].quantile(0.7)]
        if len(high_value) < ring_size:
            high_value = candidates

        ring_idxs = high_value.sample(ring_size, replace=False).index
        adjuster = random.choice(adjuster_pool)

        df.loc[ring_idxs, "adjuster_id"] = adjuster
        df.loc[ring_idxs, "label_is_fraud"] = 1
        df.loc[ring_idxs, "fraud_scenario"] = "adjuster_collusion"
        # approved at unusually high ratio
        df.loc[ring_idxs, "approved_amount"] = (df.loc[ring_idxs, "claim_amount"] * 0.97).round(2)
        df.loc[ring_idxs, "status"] = "APPROVED"

    return df


def inject_phantom_policy(
    df_claims: pd.DataFrame,
    n_clusters: int = 5,
    ring_size: int = 15,
) -> pd.DataFrame:
    """
    Multiple claims filed against the same policy in rapid succession,
    suggesting a phantom or stolen policy being exploited.
    ~5 clusters x 15 claims = ~75 fraud claims.
    """
    df = df_claims.copy()
    # find policies with enough existing claims
    counts = df[df["label_is_fraud"] == 0].groupby("policy_id").size()
    eligible = counts[counts >= 3].index.tolist()

    if not eligible:
        return df

    chosen_policies = random.sample(eligible, min(n_clusters, len(eligible)))

    for pol_id in chosen_policies:
        pool = df[(df["policy_id"] == pol_id) & (df["label_is_fraud"] == 0)]
        n = min(ring_size, len(pool))
        if n < 3:
            continue
        idxs = pool.sample(n, replace=False).index

        df.loc[idxs, "label_is_fraud"] = 1
        df.loc[idxs, "fraud_scenario"] = "phantom_policy_exploitation"
        df.loc[idxs, "days_to_file"] = [random.randint(0, 2) for _ in idxs]
        df.loc[idxs, "claim_amount"] = (df.loc[idxs, "claim_amount"] * 1.4).round(2)

    return df
from pathlib import Path
from src.data_gen.generator import GenConfig, generate_all

if __name__ == "__main__":
    out_dir = Path("data/raw")
    out_dir.mkdir(parents=True, exist_ok=True)

    cfg = GenConfig(
        seed=42,
        n_policyholders=2500,
        n_addresses=1800,
        n_policies=2600,
        n_claims=9000,
        n_bank_accounts=2200,
        n_providers=250,
        n_shops=180,
        n_law_firms=60,
        n_adjusters=50,
        n_vehicles=2200,
    )

    print("Generating synthetic insurance dataset...")
    dfs = generate_all(cfg)

    for name, df in dfs.items():
        path = out_dir / f"{name}.csv"
        df.to_csv(path, index=False)
        print(f"Saved: {path}")

from __future__ import annotations
import os
from dataclasses import dataclass
from dotenv import load_dotenv
from pathlib import Path

# Load .env from services/api/.env explicitly (works regardless of where you run uvicorn from)
ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(dotenv_path=ENV_PATH)

@dataclass(frozen=True)
class Settings:
    neo4j_uri: str = os.getenv("NEO4J_URI", "neo4j://127.0.0.1:7687")
    neo4j_user: str = os.getenv("NEO4J_USER", "neo4j")
    neo4j_password: str = os.getenv("NEO4J_PASSWORD", "12345678")
    api_key: str = os.getenv("API_KEY", "my-local-key")

settings = Settings()

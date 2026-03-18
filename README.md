# Insurance Claims Fraud Detection — Graph + ML Platform

A full-stack fraud detection platform that combines **Neo4j graph analytics**, **XGBoost**, **GraphSAGE (GNN)**, and a **LangGraph-powered AI investigation agent** to detect and explain insurance fraud patterns across auto, home, and health claims.

The system generates a realistic synthetic dataset of 9,000+ claims with 8 injected fraud scenarios (~25% fraud rate), loads it into a Neo4j graph database, trains ML models on graph-derived features, and serves everything through a **FastAPI** backend and **Next.js** dashboard.

![Mule Account Ring — Graph Visualization](screenshots/Screenshot%201%20—%20The%20Mule%20Account%20Ring.png)

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Graph Schema](#graph-schema)
- [Fraud Scenarios](#fraud-scenarios)
- [Prerequisites](#prerequisites)
- [Step-by-Step Setup](#step-by-step-setup)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Install Neo4j](#2-install-neo4j)
  - [3. Set Up the Python Backend](#3-set-up-the-python-backend)
  - [4. Generate Synthetic Data](#4-generate-synthetic-data)
  - [5. Load Data into Neo4j](#5-load-data-into-neo4j)
  - [6. Train the ML Models](#6-train-the-ml-models)
  - [7. Start the API Server](#7-start-the-api-server)
  - [8. Set Up the Frontend](#8-set-up-the-frontend)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
- [LangGraph Investigation Agent](#langgraph-investigation-agent)
- [Screenshots](#screenshots)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Next.js Frontend                            │
│  Dashboard · Claim Detail · Graph View · Chat · Cases               │
│  (React 19 + Tailwind 4 + Recharts + react-force-graph)            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST API
┌──────────────────────────────▼──────────────────────────────────────┐
│                          FastAPI Backend                             │
│  Auth (JWT) · Claims · Scoring · Patterns · Chat · Graph · ML/GNN  │
│  LangGraph Agent (Anthropic Claude → OpenAI GPT-4o fallback)        │
└─────────┬────────────────────┬──────────────────┬───────────────────┘
          │                    │                  │
     ┌────▼────┐         ┌────▼────┐       ┌─────▼─────┐
     │  Neo4j  │         │ XGBoost │       │ GraphSAGE │
     │  Graph  │         │  Model  │       │ GNN Model │
     │   DB    │         │  (.json)│       │   (.pt)   │
     └─────────┘         └─────────┘       └───────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS 4, Recharts, react-force-graph |
| **Backend** | Python 3.12+, FastAPI, Uvicorn, Pydantic |
| **Graph Database** | Neo4j 5.x (Bolt protocol) |
| **ML — Tabular** | XGBoost, scikit-learn, pandas, NumPy |
| **ML — Graph** | PyTorch, PyTorch Geometric (GraphSAGE) |
| **AI Agent** | LangGraph, LangChain, Anthropic Claude, OpenAI GPT-4o (fallback) |
| **Observability** | LangSmith tracing |
| **Auth** | JWT (python-jose + bcrypt), role-based access control |
| **Data Generation** | Faker, custom fraud injection engine |
| **Package Management** | Poetry (Python), npm (Node.js) |

## Graph Schema

The Neo4j graph models the full insurance claims ecosystem with **10 node types** and **9 relationship types**:

```
(PolicyHolder)-[:LIVES_AT]->(Address)
(PolicyHolder)-[:HAS_POLICY]->(Policy)
(Policy)-[:HAS_CLAIM]->(Claim)
(Claim)-[:PAID_TO]->(BankAccount)
(Claim)-[:HANDLED_BY]->(Adjuster)
(Claim)-[:INVOLVES_VEHICLE]->(Vehicle)
(Claim)-[:TREATED_BY]->(Provider)
(Claim)-[:REPAIRED_BY]->(RepairShop)
(Claim)-[:REPRESENTED_BY]->(LawFirm)
(Provider/RepairShop/LawFirm)-[:LOCATED_AT]->(Address)
```

## Fraud Scenarios

The synthetic data generator injects **8 distinct fraud patterns** targeting ~25% of claims:

| Scenario | Description | Approx. Claims |
|----------|-------------|----------------|
| **Shared Bank Account Ring** | Multiple unrelated claimants route payouts to the same mule account | ~300 |
| **Shared Address/Phone Cluster** | Synthetic identity cluster — many policyholders share an address and phone | ~96 |
| **Collusive Provider** | A healthcare provider processes an unusual concentration of fraudulent claims | ~120 |
| **Triangle: Law Firm + Provider** | Repeated pairing of the same law firm and provider across claims | ~90 |
| **Rapid Reclaim Burst** | A single policyholder files many claims in rapid succession | ~200 |
| **Inflated Repair Shop** | An auto body shop systematically bills 2.5× normal amounts | ~80 |
| **Adjuster Collusion** | A corrupt adjuster approves a cluster of high-value claims at ~97% payout | ~90 |
| **Phantom Policy Exploitation** | Multiple claims filed against the same policy in rapid succession | ~75 |

---

## Prerequisites

Before starting, make sure you have the following installed on your machine:

| Requirement | Version | How to Install |
|-------------|---------|----------------|
| **Python** | 3.12+ | [python.org](https://www.python.org/downloads/) |
| **Poetry** | 2.x | `pip install poetry` or [install docs](https://python-poetry.org/docs/#installation) |
| **Node.js** | 18+ (LTS recommended) | [nodejs.org](https://nodejs.org/) |
| **npm** | 9+ (comes with Node.js) | Bundled with Node.js |
| **Neo4j** | 5.x | See [Step 2](#2-install-neo4j) below |
| **Git** | Any recent version | [git-scm.com](https://git-scm.com/) |

You will also need API keys for the AI chat agent (optional — the rest of the platform works without them):

- **Anthropic API Key** — for Claude (primary LLM)
- **OpenAI API Key** — for GPT-4o (fallback LLM)

---

## Step-by-Step Setup

### 1. Clone the Repository

```bash
git clone https://github.com/matusalemcassim/insurance-claims-fraud-graph.git
cd insurance-claims-fraud-graph
```

### 2. Install Neo4j

You have several options for running Neo4j:

**Option A — Neo4j Desktop (recommended for beginners)**

1. Download [Neo4j Desktop](https://neo4j.com/download/) and install it.
2. Create a new project and add a **Local DBMS** (version 5.x).
3. Set the password (e.g., `12345678` — you'll use this in your `.env` file).
4. Start the database. It will be available at `bolt://localhost:7687`.

**Option B — Docker**

```bash
docker run -d \
  --name neo4j-fraud \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/12345678 \
  -e NEO4J_PLUGINS='["apoc"]' \
  neo4j:5
```

**Option C — Neo4j AuraDB (cloud)**

1. Create a free instance at [neo4j.com/cloud/aura](https://neo4j.com/cloud/aura/).
2. Note the connection URI (it will look like `neo4j+s://xxxxxxxx.databases.neo4j.io`).
3. Use the provided credentials in your `.env` file.

Verify Neo4j is running by opening [http://localhost:7474](http://localhost:7474) in your browser (for local installations).

### 3. Set Up the Python Backend

The project has two Poetry environments: one at the root (for data generation) and one in `services/api` (for the API server).

**Root environment (data generation + Neo4j loading):**

```bash
# From the project root
poetry install
```

**API environment:**

```bash
cd services/api
poetry install
cd ../..
```

> **Note on PyTorch:** The API depends on `torch` and `torch-geometric` for the GNN model. On some systems, Poetry may take a while to resolve these. If you encounter issues, you can install PyTorch separately first following the [official guide](https://pytorch.org/get-started/locally/).

Now create the environment file for the API:

```bash
cp services/api/.env.example services/api/.env  # if .env.example exists
# OR create it manually:
cat > services/api/.env << 'EOF'
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=12345678

JWT_SECRET_KEY=your-random-secret-key-here

# Optional — required only for the AI chat agent
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Optional — for LangSmith tracing
LANGSMITH_API_KEY=
LANGCHAIN_TRACING_V2=false
EOF
```

Also create a `.env` at the project root for data loading:

```bash
cat > .env << 'EOF'
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=12345678
EOF
```

### 4. Generate Synthetic Data

This creates 10 CSV files in `data/raw/` with ~9,000 claims and injected fraud patterns:

```bash
poetry run python scripts/generate_data.py
```

Expected output:

```
Generating synthetic insurance dataset...
✅ Fraud injection complete: 2XXX/9000 fraud claims (2X.X%)
shared_bank_account_ring       300
rapid_reclaim_burst            200
collusive_provider             120
...
Saved: data/raw/addresses.csv
Saved: data/raw/claims.csv
... (10 files total)
```

### 5. Load Data into Neo4j

Make sure Neo4j is running, then load the generated CSVs into the graph:

```bash
poetry run python scripts/load_neo4j.py
```

Expected output:

```
✅ Loaded all data into Neo4j successfully.
```

You can verify the data in the Neo4j Browser ([http://localhost:7474](http://localhost:7474)) by running:

```cypher
// Count all nodes
MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count ORDER BY count DESC;

// Check fraud distribution
MATCH (c:Claim) WHERE c.label_is_fraud = 1
RETURN c.fraud_scenario AS scenario, count(*) AS n ORDER BY n DESC;
```

### 6. Train the ML Models

**XGBoost model** (extracts features from Neo4j, trains, and saves to `services/api/app/ml/`):

```bash
poetry run python scripts/train_model.py
```

This outputs a classification report with AUC-ROC score and saves `fraud_model.json` + `features.json`.

**GraphSAGE GNN model** (builds a PyTorch Geometric graph from Neo4j and trains):

```bash
cd services/api
poetry run python ../../scripts/train_gnn.py
cd ../..
```

This saves `gnn_model.pt` + `gnn_meta.json` to `services/api/app/ml/`.

> **Note:** Pre-trained model files are included in the repository, so you can skip this step if you just want to run the platform.

### 7. Start the API Server

```bash
cd services/api
poetry run uvicorn app.main:app --reload --port 8000
```

The API will be available at [http://localhost:8000](http://localhost:8000). Interactive docs are at [http://localhost:8000/docs](http://localhost:8000/docs).

On first launch, the server seeds three default users into Neo4j:

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | admin |
| `manager` | `manager123` | manager |
| `investigator` | `investigator123` | investigator |

### 8. Set Up the Frontend

In a new terminal:

```bash
cd apps/web
npm install
npm run dev
```

The dashboard will be available at [http://localhost:3000](http://localhost:3000).

Log in with one of the default credentials above (e.g., `admin` / `admin123`).

---

## Environment Variables

### `services/api/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `NEO4J_URI` | Yes | Neo4j connection URI (e.g., `bolt://localhost:7687`) |
| `NEO4J_USER` | Yes | Neo4j username (default: `neo4j`) |
| `NEO4J_PASSWORD` | Yes | Neo4j password |
| `JWT_SECRET_KEY` | Yes | Secret for signing JWT tokens (use a long random string) |
| `ANTHROPIC_API_KEY` | No | Anthropic API key — enables the AI chat agent |
| `OPENAI_API_KEY` | No | OpenAI API key — fallback for the AI chat agent |
| `LANGSMITH_API_KEY` | No | LangSmith API key for tracing |
| `LANGCHAIN_TRACING_V2` | No | Set to `true` to enable LangSmith tracing |

### Root `.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `NEO4J_URI` | Yes | Same as above |
| `NEO4J_USER` | Yes | Same as above |
| `NEO4J_PASSWORD` | Yes | Same as above |

---

## API Endpoints

The FastAPI backend exposes these route groups (all documented at `/docs`):

| Route Group | Prefix | Description |
|-------------|--------|-------------|
| **Auth** | `/auth` | Login, token refresh, user management |
| **Claims** | `/claims` | List, filter, and retrieve claims from Neo4j |
| **Graph** | `/graph` | Graph neighborhood queries (for the force-graph visualization) |
| **Scoring** | `/scoring` | Rule-based fraud risk scoring with explainable signal breakdown |
| **ML** | `/ml` | XGBoost model inference on individual claims |
| **GNN** | `/gnn` | GraphSAGE model inference |
| **Patterns** | `/patterns` | Detect fraud patterns (shared bank accounts, adjuster hubs, etc.) |
| **Chat** | `/chat` | LangGraph AI agent — natural language fraud investigation |
| **Cases** | `/cases` | Investigation case management (create, update, assign) |
| **Documents** | `/documents` | Upload and manage claim-related documents (PDF) |
| **Summary** | `/summary` | AI-generated claim summaries |
| **Health** | `/health` | Health check endpoint |

---

## LangGraph Investigation Agent

The chat feature is powered by a **LangGraph state machine** that orchestrates a multi-step fraud investigation workflow:

```
User Message → Guardrails → Generate Cypher → Execute on Neo4j → Summarize → Respond
```

Key features of the agent:

- **Topic guardrails** — rejects off-topic questions that aren't related to insurance or fraud
- **Cypher safety** — blocks any destructive queries (DELETE, DROP, SET, etc.)
- **Claim-scoped context** — when chatting from a specific claim's detail page, the agent automatically scopes queries to that claim
- **LLM fallback chain** — tries Anthropic Claude first, retries once, then falls back to OpenAI GPT-4o
- **Conversation memory** — persists chat sessions per user and per claim in SQLite
- **LangSmith tracing** — full observability of each agent run (when enabled)

---

## Screenshots

| Screenshot | Description |
|------------|-------------|
| ![Graph](screenshots/Screenshot%201%20—%20The%20Mule%20Account%20Ring.png) | **Mule Account Ring** — Force-directed graph showing a bank account (center) receiving payouts from dozens of unrelated claims |
| ![Ranking](screenshots/Screenshot%202%20—%20The%20Ranking%20Table.PNG) | **Cypher Investigation** — Ranking bank accounts by the number of distinct policyholders routing payouts to them |
| ![Provider](screenshots/Screenshot%203%20—%20Suspicious%20Provider%20Hub.PNG) | **Suspicious Provider Hub** — Identifying healthcare providers with abnormally high claim volumes |
| ![Distribution](screenshots/Screenshot%204%20—%20Fraud%20Scenario%20Distribution.PNG) | **Fraud Scenario Distribution** — Breakdown of injected fraud labels across the 8 scenarios |
| ![Score](screenshots/Screenshot%205%20—%20Explainable%20Fraud%20Score.PNG) | **Explainable Fraud Score** — Composite score with sub-components (bank sharing, filing speed, claim amount) |

---

## Project Structure

```
insurance-claims-fraud-graph/
│
├── apps/
│   └── web/                        # Next.js 16 frontend
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx                # Dashboard (KPIs, charts, flagged claims)
│       │   │   ├── login/page.tsx          # Login page
│       │   │   ├── cases/page.tsx          # Investigation case management
│       │   │   ├── chat/page.tsx           # Global AI chat interface
│       │   │   ├── claim/[claimId]/        # Claim detail view
│       │   │   │   ├── ClaimClient.tsx     # Main claim detail layout
│       │   │   │   ├── GraphView.tsx       # Force-directed graph
│       │   │   │   ├── RiskScore.tsx       # Rule-based score display
│       │   │   │   ├── MLScore.tsx         # XGBoost score display
│       │   │   │   ├── CasePanel.tsx       # Case assignment panel
│       │   │   │   ├── DocumentPanel.tsx   # Document upload/view
│       │   │   │   ├── ClaimChatWidget.tsx # Claim-scoped AI chat
│       │   │   │   └── InvestigatorBriefing.tsx
│       │   │   ├── ChatWidget.tsx          # Reusable chat component
│       │   │   └── PatternsPanel.tsx       # Fraud pattern detection panel
│       │   └── lib/
│       │       ├── api.ts                  # API client helpers
│       │       └── auth.ts                 # Auth token management
│       └── package.json
│
├── services/
│   └── api/                        # FastAPI backend
│       ├── app/
│       │   ├── main.py             # FastAPI app + CORS + router registration
│       │   ├── core/
│       │   │   ├── config.py       # Settings (Neo4j URI, JWT secret)
│       │   │   └── auth.py         # JWT dependency for protected routes
│       │   ├── db/
│       │   │   └── neo4j.py        # Neo4j driver singleton
│       │   ├── routes/             # API route handlers
│       │   │   ├── auth.py         # Login, register, token refresh
│       │   │   ├── claims.py       # Claim listing + filtering
│       │   │   ├── graph.py        # Graph neighborhood queries
│       │   │   ├── scoring.py      # Rule-based fraud scoring
│       │   │   ├── ml.py           # XGBoost inference
│       │   │   ├── gnn.py          # GraphSAGE inference
│       │   │   ├── patterns.py     # Fraud pattern detection
│       │   │   ├── chat.py         # LangGraph agent endpoint
│       │   │   ├── cases.py        # Case management CRUD
│       │   │   ├── documents.py    # Document upload/retrieval
│       │   │   ├── summary.py      # AI claim summaries
│       │   │   └── health.py       # Health check
│       │   ├── services/           # Business logic layer
│       │   │   ├── chat_agent.py   # LangGraph state machine
│       │   │   ├── scoring.py      # Rule-based scoring engine
│       │   │   ├── ml_scoring.py   # XGBoost scoring service
│       │   │   ├── gnn_scoring.py  # GraphSAGE scoring service
│       │   │   ├── patterns.py     # Pattern detection queries
│       │   │   ├── claims.py       # Claims service
│       │   │   ├── cases.py        # Cases service
│       │   │   ├── graph.py        # Graph query service
│       │   │   ├── auth_service.py # JWT + bcrypt helpers
│       │   │   ├── users_service.py# User CRUD + seeding
│       │   │   ├── chat_db.py      # SQLite chat persistence
│       │   │   ├── document_agent.py
│       │   │   ├── document_store.py
│       │   │   ├── summarization.py
│       │   │   └── audit_service.py
│       │   └── ml/                 # Pre-trained model artifacts
│       │       ├── fraud_model.json    # XGBoost model
│       │       ├── features.json       # Feature column list
│       │       ├── gnn_model.pt        # GraphSAGE weights
│       │       └── gnn_meta.json       # GNN metadata (node mapping)
│       ├── uploads/                # Uploaded claim documents
│       └── pyproject.toml
│
├── scripts/
│   ├── generate_data.py            # Run the synthetic data generator
│   ├── load_neo4j.py               # Load CSVs into Neo4j
│   ├── train_model.py              # Train XGBoost fraud model
│   └── train_gnn.py                # Train GraphSAGE GNN model
│
├── src/
│   ├── data_gen/
│   │   ├── generator.py            # Synthetic data generation (10 entity types)
│   │   └── fraud_injection.py      # 8 fraud scenario injection functions
│   └── graph/
│       ├── neo4j_loader.py         # Programmatic Neo4j data loader
│       └── cypher/                 # Reference Cypher queries
│           ├── 00_constraints.cypher
│           ├── 01_load_addresses.cypher
│           ├── 02_load_policyholders.cypher
│           ├── 03_load_policies.cypher
│           ├── 04_load_entities.cypher
│           ├── 05_load_claims.cypher
│           └── 10_investigation.cypher  # Sample fraud detection queries
│
├── data/
│   └── raw/                        # Generated CSV files (10 files)
│
├── screenshots/                    # Application screenshots
├── pyproject.toml                  # Root Poetry config (data gen dependencies)
├── poetry.lock
└── .gitignore
```

---

## Troubleshooting

**Neo4j connection refused**
Make sure Neo4j is running and accessible at the URI in your `.env`. For Docker, check `docker ps`. For Desktop, make sure the DBMS is started. Verify with `cypher-shell -u neo4j -p your-password`.

**Poetry can't resolve PyTorch dependencies**
PyTorch + PyTorch Geometric can be tricky. Try installing them separately first:
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install torch-geometric
```
Then run `poetry install` again.

**Frontend can't connect to the API**
The frontend expects the API at `http://localhost:8000`. Make sure the API is running and CORS is configured (it's already set up for `localhost:3000` in `main.py`).

**Chat agent returns "all LLMs unavailable"**
Make sure you've set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` in `services/api/.env`. At least one is required for the chat feature.

**"No module named 'src'"**
Run scripts from the project root, not from inside a subdirectory. Poetry sets up the path correctly when invoked from the root.

**XGBoost/GNN training errors about missing features**
Make sure you've loaded data into Neo4j (Step 5) before training. The training scripts extract features directly from the graph database.

---

## License

This project is provided for educational and portfolio purposes.

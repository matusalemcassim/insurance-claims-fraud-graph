from __future__ import annotations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.routes.health   import router as health_router
from app.routes.claims   import router as claims_router
from app.routes.graph    import router as graph_router
from app.routes.scoring  import router as scoring_router
from app.routes.patterns import router as patterns_router
from app.routes.summary  import router as summary_router
from app.routes.ml       import router as ml_router
from app.routes.gnn      import router as gnn_router
from app.routes.cases    import router as cases_router
from app.routes.auth     import router as auth_router
from app.routes.chat     import router as chat_router
from app.routes.documents import router as documents_router
from app.db.neo4j import close_driver

@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.services.users_service import seed_default_users
    from app.services.chat_db import init_db
    seed_default_users()
    init_db()
    import os
    os.makedirs("uploads", exist_ok=True)
    yield
    close_driver()


app = FastAPI(title="Insurance Fraud Graph API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(health_router)
app.include_router(claims_router)
app.include_router(graph_router)
app.include_router(scoring_router)
app.include_router(patterns_router)
app.include_router(summary_router)
app.include_router(ml_router)
app.include_router(gnn_router)
app.include_router(cases_router)
app.include_router(chat_router)
app.include_router(documents_router)


@app.get("/")
def root():
    return {"status": "ok", "docs": "/docs"}
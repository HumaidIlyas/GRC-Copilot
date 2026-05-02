import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from db.models import init_db
from oscal.loader import load_catalog
from routes.ssp import router as ssp_router
from routes.gap import router as gap_router
from routes.poam import router as poam_router
from routes.export import router as export_router
from routes.odp import router as odp_router
from auth import auth_middleware

app = FastAPI(title="GRC Copilot API", version="0.1.0")

_frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_frontend_url, "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(auth_middleware)

app.include_router(ssp_router, prefix="/api")
app.include_router(gap_router, prefix="/api")
app.include_router(poam_router, prefix="/api")
app.include_router(export_router, prefix="/api")
app.include_router(odp_router, prefix="/api")


@app.on_event("startup")
def startup():
    init_db()
    load_catalog()


@app.get("/health")
def health():
    from llm.client import get_active_models
    return {"status": "ok", "llm": get_active_models()}

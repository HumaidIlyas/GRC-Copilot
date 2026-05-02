"""
ODP Tracking — Organization-Defined Parameters for NIST 800-53 controls.

HOW IT WORKS:
1. When a project is created, POST /odp/projects/{id}/initialize populates ODP rows
   from the 800-53A catalog for every control in the project's baseline.
2. If the project has a FedRAMP OSCAL SSP URL, parameter values from its
   set-parameters block are pre-filled automatically.
3. Analyst reviews and fills remaining values via PATCH.
4. ODP values are injected into every Claude prompt for SSP drafting and gap assessment,
   making output specific rather than generic boilerplate.
"""

import json
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from db.models import engine, Project, ProjectODP
from oscal.loader import get_baseline_odps

router = APIRouter(prefix="/odp", tags=["ODP Tracking"])


def get_db():
    from sqlalchemy.orm import sessionmaker
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class ODPValueUpdate(BaseModel):
    value: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/initialize")
def initialize_odps(project_id: str, db: Session = Depends(get_db)):
    """
    Populate ODP rows for the project from the 800-53A catalog.
    Safe to call multiple times — skips params already present.
    Returns counts of total and newly created ODP rows.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    baseline_odps = get_baseline_odps(project.baseline)
    if not baseline_odps:
        raise HTTPException(status_code=503, detail="OSCAL catalog not loaded.")

    # Index existing rows to avoid duplicates
    existing = {
        (row.control_id, row.param_id)
        for row in db.query(ProjectODP)
        .filter(ProjectODP.project_id == project_id)
        .all()
    }

    created = 0
    for control_id, odps in baseline_odps.items():
        for odp in odps:
            if (control_id, odp["param_id"]) in existing:
                continue
            db.add(ProjectODP(
                project_id=project_id,
                control_id=control_id,
                param_id=odp["param_id"],
                label=odp["label"],
                required_definition=odp["required_definition"],
                is_choice=odp["is_choice"],
                choices=json.dumps(odp["choices"]) if odp["choices"] else None,
            ))
            created += 1

    db.commit()

    total = db.query(ProjectODP).filter(ProjectODP.project_id == project_id).count()
    defined = db.query(ProjectODP).filter(
        ProjectODP.project_id == project_id,
        ProjectODP.value.isnot(None),
        ProjectODP.value != "",
    ).count()

    return {
        "created": created,
        "total": total,
        "defined": defined,
        "undefined": total - defined,
    }


@router.get("/projects/{project_id}/params")
def list_odps(
    project_id: str,
    control_id: Optional[str] = None,
    undefined_only: bool = False,
    db: Session = Depends(get_db),
):
    """
    List all ODPs for the project, optionally filtered by control or undefined status.
    """
    query = db.query(ProjectODP).filter(ProjectODP.project_id == project_id)
    if control_id:
        query = query.filter(ProjectODP.control_id == control_id.lower())
    if undefined_only:
        query = query.filter(
            (ProjectODP.value.is_(None)) | (ProjectODP.value == "")
        )

    rows = query.order_by(ProjectODP.control_id, ProjectODP.param_id).all()
    return [_serialize(r) for r in rows]


@router.get("/projects/{project_id}/params/summary")
def odp_summary(project_id: str, db: Session = Depends(get_db)):
    """
    Returns counts of defined vs undefined ODPs and a per-family breakdown.
    """
    rows = db.query(ProjectODP).filter(ProjectODP.project_id == project_id).all()
    if not rows:
        return {"total": 0, "defined": 0, "undefined": 0, "by_family": {}}

    by_family: dict[str, dict] = {}
    for r in rows:
        family = r.control_id.split("-")[0].upper()
        if family not in by_family:
            by_family[family] = {"total": 0, "defined": 0}
        by_family[family]["total"] += 1
        if r.value:
            by_family[family]["defined"] += 1

    total = len(rows)
    defined = sum(1 for r in rows if r.value)
    return {
        "total": total,
        "defined": defined,
        "undefined": total - defined,
        "completion_pct": round(defined / total * 100, 1) if total else 0,
        "by_family": by_family,
    }


@router.patch("/projects/{project_id}/params/{odp_id}")
def update_odp(
    project_id: str,
    odp_id: str,
    payload: ODPValueUpdate,
    db: Session = Depends(get_db),
):
    """Set the analyst-supplied value for an ODP."""
    row = db.query(ProjectODP).filter(
        ProjectODP.project_id == project_id,
        ProjectODP.id == odp_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="ODP not found")

    row.value = payload.value.strip()
    db.commit()
    return {"updated": odp_id, "param_id": row.param_id, "value": row.value}


# ── Helper ────────────────────────────────────────────────────────────────────

def _serialize(row: ProjectODP) -> dict:
    return {
        "id": row.id,
        "control_id": row.control_id,
        "param_id": row.param_id,
        "label": row.label,
        "required_definition": row.required_definition,
        "value": row.value or "",
        "is_choice": row.is_choice,
        "choices": json.loads(row.choices) if row.choices else [],
        "defined": bool(row.value),
    }


# ── Internal utility used by other routes ─────────────────────────────────────

def get_odp_context(project_id: str, control_id: str, db: Session) -> str:
    """
    Returns a formatted string of defined ODP values for a control,
    ready to inject into a Claude prompt. Returns empty string if no values set.
    """
    rows = db.query(ProjectODP).filter(
        ProjectODP.project_id == project_id,
        ProjectODP.control_id == control_id.lower(),
        ProjectODP.value.isnot(None),
        ProjectODP.value != "",
    ).all()

    if not rows:
        return ""

    lines = ["ORGANIZATION-DEFINED PARAMETERS (values this org has committed to):"]
    for r in rows:
        lines.append(f"  - {r.required_definition.rstrip(';')} → {r.value}")
    return "\n".join(lines)

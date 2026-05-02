"""
SSP Assistant — drafts NIST 800-53 control implementation statements.

HOW IT WORKS:
1. Analyst creates a project with system info + baseline selection
2. POST /ssp/{project_id}/draft triggers drafting for all controls in the baseline
3. For each control, we fetch its full OSCAL text (statement + guidance)
4. We send Claude a prompt that includes: system context + OSCAL control text
5. Claude returns a draft implementation statement
6. Statements are stored in SQLite; analyst edits them in the UI
"""

from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from db.models import engine, Project, Control
from oscal.loader import get_baseline_controls, get_control
from llm.client import complete
from routes.odp import get_odp_context

router = APIRouter(prefix="/ssp", tags=["SSP"])


def get_db():
    from sqlalchemy.orm import sessionmaker
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class ProjectCreate(BaseModel):
    name: str
    system_description: str
    system_boundary: str
    data_classification: str        # Low / Moderate / High
    baseline: str                   # Low / Moderate / High
    oscal_ssp_url: Optional[str] = None


class ControlUpdate(BaseModel):
    implementation_statement: str
    status: str = "reviewed"


@router.post("/projects")
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    project = Project(**payload.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    return {"id": project.id, "name": project.name}


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).all()


@router.get("/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post("/projects/{project_id}/draft")
def draft_ssp(project_id: str, db: Session = Depends(get_db)):
    """
    Trigger Claude to draft implementation statements for all controls
    in the project's baseline. Existing drafts are overwritten.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    baseline_controls = get_baseline_controls(project.baseline)
    if not baseline_controls:
        raise HTTPException(
            status_code=503,
            detail="OSCAL catalog not loaded. Download catalog and restart."
        )

    # Delete existing control drafts for this project
    db.query(Control).filter(Control.project_id == project_id).delete()

    # Collect ODP contexts before parallelising — DB session is not thread-safe
    work_items = [
        (ctrl, get_odp_context(project_id, ctrl["id"], db))
        for ctrl in baseline_controls
    ]

    # Run Claude drafting calls in parallel
    draft_results: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {
            executor.submit(_draft_implementation_statement, project, ctrl, odp_ctx): ctrl["id"]
            for ctrl, odp_ctx in work_items
        }
        for future in as_completed(futures):
            ctrl_id = futures[future]
            try:
                draft_results[ctrl_id] = future.result()
            except Exception as e:
                draft_results[ctrl_id] = f"Draft failed: {e}"

    # Write results to DB on main thread
    drafted = []
    for ctrl, _ in work_items:
        control = Control(
            project_id=project_id,
            control_id=ctrl["id"],
            family=ctrl["family"],
            title=ctrl["title"],
            implementation_statement=draft_results[ctrl["id"]],
            status="draft",
        )
        db.add(control)
        drafted.append(ctrl["id"])

    db.commit()
    return {"drafted": len(drafted), "controls": drafted}


@router.get("/projects/{project_id}/controls")
def get_controls(project_id: str, db: Session = Depends(get_db)):
    return db.query(Control).filter(Control.project_id == project_id).all()


@router.patch("/projects/{project_id}/controls/{control_id}")
def update_control(
    project_id: str,
    control_id: str,
    payload: ControlUpdate,
    db: Session = Depends(get_db),
):
    control = (
        db.query(Control)
        .filter(Control.project_id == project_id, Control.control_id == control_id)
        .first()
    )
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")
    control.implementation_statement = payload.implementation_statement
    control.status = payload.status
    db.commit()
    return {"updated": control_id}


def _draft_implementation_statement(
    project: Project, ctrl: dict, odp_context: str = ""
) -> str:
    """
    Call Claude to draft a single control implementation statement.
    OSCAL control text + any defined ODP values are injected as grounding context.
    """
    odp_section = f"\n{odp_context}\n" if odp_context else ""

    prompt = f"""You are a GRC analyst assistant helping draft a System Security Plan (SSP).

SYSTEM CONTEXT:
- System Name: {project.name}
- Description: {project.system_description}
- System Boundary: {project.system_boundary}
- Data Classification: {project.data_classification}
- NIST Baseline: {project.baseline}

CONTROL TO IMPLEMENT:
Control ID: {ctrl["id"].upper()}
Title: {ctrl["title"]}
Control Statement:
{ctrl["statement"]}

Supplemental Guidance (excerpt):
{ctrl["guidance"]}
{odp_section}
TASK:
Write a concise implementation statement (2-4 sentences) that describes HOW this specific system
implements the above control. The statement should:
- Be specific to the system described above, not generic
- Where organization-defined parameters are listed above, use those exact values in the statement
- Use plain language an auditor can verify
- Follow FedRAMP SSP implementation statement conventions
- Not restate the control requirement — describe how the system meets it

Return only the implementation statement text, no preamble."""

    return complete(prompt, task="draft")

"""
POA&M Generator — drafts Plan of Action & Milestones from gap findings.

HOW IT WORKS:
1. Pull all gaps for the project where status != "Implemented"
2. For each gap, Claude drafts a POA&M entry:
   - Weakness description (what's missing)
   - Risk level (High / Medium / Low based on control family and gap severity)
   - Remediation steps (3-5 actionable bullets)
   - Milestone timeline (suggested 30/60/90 day milestones)
3. Analyst reviews and edits each entry before export
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

import json
from db.models import engine, Project, Gap, PoamItem
from oscal.loader import get_control
from llm.client import complete, complete_structured

router = APIRouter(prefix="/poam", tags=["POA&M"])


def get_db():
    from sqlalchemy.orm import sessionmaker
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class PoamItemUpdate(BaseModel):
    weakness_description: Optional[str] = None
    risk_level: Optional[str] = None
    remediation_steps: Optional[str] = None
    milestones: Optional[str] = None
    status: Optional[str] = None


@router.post("/projects/{project_id}/generate")
def generate_poam(project_id: str, db: Session = Depends(get_db)):
    """
    Generate POA&M entries for all non-implemented controls in the project.
    Skips controls already marked as Implemented.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    gaps = (
        db.query(Gap)
        .filter(
            Gap.project_id == project_id,
            Gap.gap_status.in_(["Not Implemented", "Partially Implemented", "Planned"]),
        )
        .all()
    )

    if not gaps:
        return {"message": "No gaps found. Run gap assessment first.", "generated": 0}

    # Clear existing POA&M items
    db.query(PoamItem).filter(PoamItem.project_id == project_id).delete()

    generated = []
    for gap in gaps:
        ctrl = get_control(gap.control_id)
        cve_ids = json.loads(gap.cve_refs or "[]")
        entry = _draft_poam_entry(project, gap, ctrl, cve_ids)
        item = PoamItem(
            project_id=project_id,
            control_id=gap.control_id,
            cve_refs=gap.cve_refs or "[]",
            **entry,
        )
        db.add(item)
        generated.append(gap.control_id)

    db.commit()
    return {"generated": len(generated), "items": generated}


@router.get("/projects/{project_id}/items")
def get_poam_items(project_id: str, db: Session = Depends(get_db)):
    return db.query(PoamItem).filter(PoamItem.project_id == project_id).all()


@router.patch("/projects/{project_id}/items/{item_id}")
def update_poam_item(
    project_id: str,
    item_id: str,
    payload: PoamItemUpdate,
    db: Session = Depends(get_db),
):
    item = (
        db.query(PoamItem)
        .filter(PoamItem.project_id == project_id, PoamItem.id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="POA&M item not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(item, field, value)

    db.commit()
    return {"updated": item_id}


def _draft_poam_entry(
    project: Project, gap: Gap, ctrl: Optional[dict], cve_ids: list
) -> dict:
    """
    Ask Claude to draft one POA&M entry grounded in gap findings and CVE evidence.
    """
    control_text = f"Control Statement:\n{ctrl['statement']}" if ctrl else ""

    cve_section = ""
    if cve_ids:
        cve_section = f"\nCVE EVIDENCE: {', '.join(cve_ids)}\n"
        cve_section += "(These known vulnerabilities support the gap finding above)\n"

    prompt = f"""You are a GRC analyst drafting a Plan of Action & Milestones (POA&M) entry.

SYSTEM: {project.name}
CONTROL: {gap.control_id.upper()} — {gap.title}
GAP STATUS: {gap.gap_status}
ASSESSOR RATIONALE: {gap.rationale}
{cve_section}
{control_text}

Draft a POA&M entry in exactly this format (4 labeled sections):

WEAKNESS:
<2-3 sentences describing the specific weakness or gap>

RISK LEVEL:
<High|Medium|Low> — <one sentence justification>

REMEDIATION STEPS:
1. <step>
2. <step>
3. <step>
(add up to 5 steps if needed)

MILESTONES:
- 30 days: <milestone>
- 60 days: <milestone>
- 90 days: <milestone or completion>

Return only these four sections, no additional text."""

    schema = {
        "name": "record_poam_entry",
        "description": "Record a structured POA&M entry for a NIST 800-53 gap finding",
        "properties": {
            "weakness_description": {
                "type": "string",
                "description": "2-3 sentences describing the specific weakness",
            },
            "risk_level": {
                "type": "string",
                "description": "High | Medium | Low",
            },
            "remediation_steps": {
                "type": "string",
                "description": "Numbered remediation steps, one per line",
            },
            "milestones": {
                "type": "string",
                "description": "30/60/90-day milestone timeline, one per line",
            },
        },
        "required": ["weakness_description", "risk_level", "remediation_steps", "milestones"],
    }

    result = complete_structured(prompt, schema, task="draft")
    if result:
        return {
            "weakness_description": result.get("weakness_description", ""),
            "risk_level": result.get("risk_level", "Medium"),
            "remediation_steps": result.get("remediation_steps", ""),
            "milestones": result.get("milestones", ""),
        }
    # Fallback to text parsing
    return _parse_poam_response(complete(prompt, task="draft"))


def _parse_poam_response(text: str) -> dict:
    sections = {"weakness_description": "", "risk_level": "", "remediation_steps": "", "milestones": ""}
    current = None
    lines = {"WEAKNESS": [], "RISK LEVEL": [], "REMEDIATION STEPS": [], "MILESTONES": []}

    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("WEAKNESS:"):
            current = "WEAKNESS"
        elif stripped.startswith("RISK LEVEL:"):
            current = "RISK LEVEL"
            rest = stripped.replace("RISK LEVEL:", "").strip()
            if rest:
                lines[current].append(rest)
        elif stripped.startswith("REMEDIATION STEPS:"):
            current = "REMEDIATION STEPS"
        elif stripped.startswith("MILESTONES:"):
            current = "MILESTONES"
        elif current and stripped:
            lines[current].append(stripped)

    sections["weakness_description"] = " ".join(lines["WEAKNESS"])
    risk_raw = " ".join(lines["RISK LEVEL"])
    sections["risk_level"] = risk_raw.split("—")[0].strip() if "—" in risk_raw else risk_raw
    sections["remediation_steps"] = "\n".join(lines["REMEDIATION STEPS"])
    sections["milestones"] = "\n".join(lines["MILESTONES"])
    return sections

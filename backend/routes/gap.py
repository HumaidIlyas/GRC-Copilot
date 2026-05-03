"""
Gap Assessment — maps a FedRAMP OSCAL SSP + NVD CVE data against NIST 800-53 baseline.

HOW IT WORKS:
1. Analyst provides a FedRAMP OSCAL SSP (URL or raw JSON upload)
2. SSP is parsed: control implementations + software components + ODP values extracted
3. NVD is queried for CVEs affecting the system's software components
4. CVEs are grouped by 800-53 control via CWE→control mapping
5. For each control in the baseline, Claude receives:
     - SSP implementation statement (what org claims)
     - 800-53A assessment objectives (what must be true)
     - Relevant CVEs (what is actually broken)
     - ODP values the org committed to
6. Claude returns: status + rationale + per-objective findings
7. Results stored in SQLite; analyst reviews before export

Old file-upload endpoint (POST /gap/projects/{id}/assess) is retained for backward compat.
"""

import json
import io
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from db.models import engine, Project, Gap
from oscal.loader import get_baseline_controls
from oscal.ssp_parser import fetch_and_parse, extract_nvd_search_terms
from nvd.client import fetch_cves_for_components, group_cves_by_control
from llm.client import complete, complete_structured, complete_batch_structured
from routes.odp import get_odp_context

_GAP_SCHEMA = {
    "name": "record_gap_assessment",
    "description": "Record the structured gap assessment result for a NIST 800-53 control",
    "properties": {
        "status": {
            "type": "string",
            "description": "Implemented | Partially Implemented | Not Implemented",
        },
        "rationale": {
            "type": "string",
            "description": "One sentence citing SSP text or CVE IDs as evidence",
        },
        "objective_findings": {
            "type": "string",
            "description": (
                "JSON array of {objective, met, note} objects. "
                "met values: MET | PARTIAL | UNMET"
            ),
        },
    },
    "required": ["status", "rationale", "objective_findings"],
}

router = APIRouter(prefix="/gap", tags=["Gap Assessment"])


def get_db():
    from sqlalchemy.orm import sessionmaker
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class SspAssessRequest(BaseModel):
    ssp_url: Optional[str] = None       # public OSCAL SSP URL
    fetch_cves: bool = True             # query NVD for CVEs


# ── New primary endpoint — SSP + NVD pipeline ────────────────────────────────

@router.post("/projects/{project_id}/assess-from-ssp")
def assess_from_ssp(
    project_id: str,
    payload: SspAssessRequest,
    db: Session = Depends(get_db),
):
    """
    Run gap assessment using:
      - FedRAMP OSCAL SSP (project's stored URL or payload.ssp_url)
      - NVD CVE data for the system's software components
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Resolve SSP source
    ssp_source = payload.ssp_url or project.oscal_ssp_url
    if not ssp_source:
        raise HTTPException(
            status_code=400,
            detail="No SSP source. Provide ssp_url or set oscal_ssp_url on the project."
        )

    # Persist URL on project if new
    if payload.ssp_url and payload.ssp_url != project.oscal_ssp_url:
        project.oscal_ssp_url = payload.ssp_url
        db.commit()

    # Parse SSP
    try:
        parsed_ssp = fetch_and_parse(ssp_source)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"SSP parse error: {e}")

    # Pre-fill ODP values from SSP set-parameters if not already set
    _apply_ssp_odp_values(project_id, parsed_ssp["set_parameters"], db)

    # Fetch CVEs from NVD
    cve_by_control: dict[str, list[dict]] = {}
    if payload.fetch_cves:
        search_terms = extract_nvd_search_terms(parsed_ssp)
        if search_terms:
            all_cves = fetch_cves_for_components(search_terms[:5], max_per_component=15)
            cve_by_control = group_cves_by_control(all_cves)

    # Run assessment
    baseline_controls = get_baseline_controls(project.baseline)
    if not baseline_controls:
        raise HTTPException(status_code=503, detail="OSCAL catalog not loaded.")

    db.query(Gap).filter(Gap.project_id == project_id).delete()

    control_statuses = parsed_ssp.get("control_statuses", {})

    # Collect all inputs on the main thread
    work_items = [
        (
            ctrl,
            parsed_ssp["implemented_controls"].get(ctrl["id"], ""),
            control_statuses.get(ctrl["id"], ""),
            cve_by_control.get(ctrl["id"], []),
            get_odp_context(project_id, ctrl["id"], db),
        )
        for ctrl in baseline_controls
    ]

    # Pre-filter — no Claude call needed for these cases:
    #   inherited      → satisfied by underlying platform (e.g. AWS GovCloud)
    #   not-applicable → control doesn't apply to this system
    #   planned        → acknowledged gap, remediation planned
    #   no statement   → nothing in SSP at all → Not Implemented
    _SKIP_STATUSES = {
        "inherited":     ("Inherited",      "Control inherited from underlying platform per SSP."),
        "not-applicable":("Not Applicable", "Control marked not applicable in SSP."),
        "planned":       ("Planned",        "Control not yet implemented; remediation planned per SSP."),
    }

    assessment_results: dict[str, dict] = {}
    needs_claude = []
    for ctrl, ssp_stmt, ctrl_status, cves, odp_ctx in work_items:
        if ctrl_status in _SKIP_STATUSES:
            label, rationale = _SKIP_STATUSES[ctrl_status]
            assessment_results[ctrl["id"]] = {
                "status": label, "rationale": rationale, "objective_findings": [],
            }
        elif not ssp_stmt.strip():
            assessment_results[ctrl["id"]] = {
                "status": "Not Implemented",
                "rationale": "No implementation statement found in SSP.",
                "objective_findings": [],
            }
        else:
            needs_claude.append((ctrl, ssp_stmt, cves, odp_ctx))

    # Batch all remaining controls into a single Anthropic Message Batch
    if needs_claude:
        batch_requests = [
            {
                "custom_id": ctrl["id"],
                "prompt": _build_assessment_prompt(ctrl, ssp_stmt, cves, odp_ctx),
                "schema": _GAP_SCHEMA,
            }
            for ctrl, ssp_stmt, cves, odp_ctx in needs_claude
        ]
        batch_results = complete_batch_structured(batch_requests, task="classify")

        for ctrl, _, _, _ in needs_claude:
            ctrl_id = ctrl["id"]
            raw = batch_results.get(ctrl_id, {})
            assessment_results[ctrl_id] = (
                _parse_structured_result(raw)
                if raw else
                {"status": "Not Implemented", "rationale": "Batch assessment failed.", "objective_findings": []}
            )

    # Write all results to DB
    results = []
    for ctrl, _, _, relevant_cves, _ in work_items:
        ctrl_id = ctrl["id"]
        result = assessment_results[ctrl_id]
        gap = Gap(
            project_id=project_id,
            control_id=ctrl_id,
            family=ctrl["family"],
            title=ctrl["title"],
            gap_status=result["status"],
            rationale=result["rationale"],
            objective_findings=json.dumps(result["objective_findings"]),
            cve_refs=json.dumps([c["id"] for c in relevant_cves]),
        )
        db.add(gap)
        results.append({"control_id": ctrl_id, "status": result["status"]})

    db.commit()
    return {
        "assessed": len(results),
        "ssp_controls_found": len(parsed_ssp["implemented_controls"]),
        "pre_filtered": len(work_items) - len(needs_claude),
        "sent_to_claude": len(needs_claude),
        "cve_mappings": sum(len(v) for v in cve_by_control.values()),
        "summary": _summarize(results),
        "results": results,
    }


@router.get("/projects/{project_id}/gaps")
def get_gaps(project_id: str, db: Session = Depends(get_db)):
    rows = db.query(Gap).filter(Gap.project_id == project_id).all()
    return [_serialize_gap(r) for r in rows]


# ── Legacy file-upload endpoint (kept for backward compat) ───────────────────

@router.post("/projects/{project_id}/assess")
async def assess_from_files(
    project_id: str,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    """
    Legacy: upload documents and run gap assessment against them.
    Prefer /assess-from-ssp for the full SSP+NVD pipeline.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    combined_text = ""
    for file in files:
        content = await file.read()
        combined_text += _extract_text(file.filename, content) + "\n\n"

    if not combined_text.strip():
        raise HTTPException(status_code=400, detail="No readable text in uploaded files")

    baseline_controls = get_baseline_controls(project.baseline)
    if not baseline_controls:
        raise HTTPException(status_code=503, detail="OSCAL catalog not loaded.")

    db.query(Gap).filter(Gap.project_id == project_id).delete()

    results = []
    for ctrl in baseline_controls:
        status, rationale = _assess_control_simple(ctrl, combined_text[:4000])
        gap = Gap(
            project_id=project_id,
            control_id=ctrl["id"],
            family=ctrl["family"],
            title=ctrl["title"],
            gap_status=status,
            rationale=rationale,
            objective_findings=json.dumps([]),
            cve_refs=json.dumps([]),
        )
        db.add(gap)
        results.append({"control_id": ctrl["id"], "status": status})

    db.commit()
    return {"assessed": len(results), "summary": _summarize(results), "results": results}


# ── Assessment logic ──────────────────────────────────────────────────────────

def _build_assessment_prompt(ctrl: dict, ssp_statement: str, cves: list[dict], odp_context: str) -> str:
    objectives = ctrl.get("assessment_objectives", [])
    objectives_text = ""
    if objectives:
        objectives_text = "ASSESSMENT OBJECTIVES (each must be satisfied):\n"
        for i, obj in enumerate(objectives[:10], 1):
            objectives_text += f"  {i}. {obj}\n"

    cve_text = ""
    if cves:
        cve_text = "\nKNOWN VULNERABILITIES IN THIS SYSTEM (from NVD):\n"
        for cve in cves[:5]:
            cve_text += (
                f"  - {cve['id']} ({cve['severity']}, CVSS {cve['cvss_score']}): "
                f"{cve['description'][:150]}\n"
            )

    odp_section = f"\n{odp_context}\n" if odp_context else ""

    return f"""You are a NIST 800-53 compliance assessor performing a gap assessment.

CONTROL: {ctrl["id"].upper()} — {ctrl["title"]}
CONTROL STATEMENT:
{ctrl["statement"]}

{objectives_text}
SSP IMPLEMENTATION STATEMENT (what the organization claims):
{ssp_statement}
{odp_section}{cve_text}
TASK:
Assess this control based on the SSP statement and any CVE evidence above.
If CVEs are present, they represent real weaknesses that contradict the SSP claims.

Respond in EXACTLY this format — no other text:

STATUS: <Implemented|Partially Implemented|Not Implemented>
RATIONALE: <one sentence — cite specific SSP text or CVE IDs as evidence>
FINDINGS:
<objective text> | <MET|PARTIAL|UNMET> | <brief note>
<objective text> | <MET|PARTIAL|UNMET> | <brief note>"""


def _parse_structured_result(raw: dict) -> dict:
    obj_findings = []
    raw_findings = raw.get("objective_findings", "[]")
    if isinstance(raw_findings, str):
        try:
            obj_findings = json.loads(raw_findings)
        except Exception:
            obj_findings = []
    elif isinstance(raw_findings, list):
        obj_findings = raw_findings
    return {
        "status": raw.get("status", "Not Implemented"),
        "rationale": raw.get("rationale", ""),
        "objective_findings": obj_findings,
    }


def _assess_control_full(
    ctrl: dict,
    ssp_statement: str,
    cves: list[dict],
    odp_context: str,
) -> dict:
    """
    Full assessment using SSP statement + CVEs + assessment objectives + ODPs.
    Returns {status, rationale, objective_findings}.
    """
    objectives = ctrl.get("assessment_objectives", [])
    objectives_text = ""
    if objectives:
        objectives_text = "ASSESSMENT OBJECTIVES (each must be satisfied):\n"
        for i, obj in enumerate(objectives[:10], 1):  # cap at 10 to manage tokens
            objectives_text += f"  {i}. {obj}\n"

    cve_text = ""
    if cves:
        cve_text = "\nKNOWN VULNERABILITIES IN THIS SYSTEM (from NVD):\n"
        for cve in cves[:5]:  # cap at 5 CVEs per control
            cve_text += (
                f"  - {cve['id']} ({cve['severity']}, CVSS {cve['cvss_score']}): "
                f"{cve['description'][:150]}\n"
            )

    ssp_text = ssp_statement if ssp_statement else "(No implementation statement found in SSP)"
    odp_section = f"\n{odp_context}\n" if odp_context else ""

    prompt = f"""You are a NIST 800-53 compliance assessor performing a gap assessment.

CONTROL: {ctrl["id"].upper()} — {ctrl["title"]}
CONTROL STATEMENT:
{ctrl["statement"]}

{objectives_text}
SSP IMPLEMENTATION STATEMENT (what the organization claims):
{ssp_text}
{odp_section}{cve_text}
TASK:
Assess this control based on the SSP statement and any CVE evidence above.
If CVEs are present, they represent real weaknesses that contradict the SSP claims.

Respond in EXACTLY this format — no other text:

STATUS: <Implemented|Partially Implemented|Not Implemented>
RATIONALE: <one sentence — cite specific SSP text or CVE IDs as evidence>
FINDINGS:
<objective text> | <MET|PARTIAL|UNMET> | <brief note>
<objective text> | <MET|PARTIAL|UNMET> | <brief note>"""

    schema = {
        "name": "record_gap_assessment",
        "description": "Record the structured gap assessment result for a NIST 800-53 control",
        "properties": {
            "status": {
                "type": "string",
                "description": "Implemented | Partially Implemented | Not Implemented",
            },
            "rationale": {
                "type": "string",
                "description": "One sentence citing SSP text or CVE IDs as evidence",
            },
            "objective_findings": {
                "type": "string",
                "description": (
                    "JSON array of {objective, met, note} objects. "
                    "met values: MET | PARTIAL | UNMET"
                ),
            },
        },
        "required": ["status", "rationale", "objective_findings"],
    }

    result = complete_structured(prompt, schema, task="classify")
    if not result:
        # Fallback to text parsing if structured call fails
        return _parse_full_assessment(complete(prompt, task="classify"), objectives)

    # Parse objective_findings — Claude returns it as a JSON string
    obj_findings = []
    raw_findings = result.get("objective_findings", "[]")
    if isinstance(raw_findings, str):
        try:
            obj_findings = json.loads(raw_findings)
        except Exception:
            obj_findings = []
    elif isinstance(raw_findings, list):
        obj_findings = raw_findings

    return {
        "status": result.get("status", "Not Implemented"),
        "rationale": result.get("rationale", ""),
        "objective_findings": obj_findings,
    }


def _assess_control_simple(ctrl: dict, doc_text: str) -> tuple[str, str]:
    """Simple assessment against uploaded text (legacy path)."""
    prompt = f"""You are a NIST 800-53 compliance assessor.

CONTROL: {ctrl["id"].upper()} — {ctrl["title"]}
{ctrl["statement"]}

DOCUMENTATION:
{doc_text}

Respond in exactly this format:
STATUS: <Implemented|Partially Implemented|Not Implemented>
RATIONALE: <one sentence>"""

    response = complete(prompt, task="classify")
    status, rationale = "Not Implemented", "Unable to parse response."
    for line in response.split("\n"):
        if line.startswith("STATUS:"):
            status = line.replace("STATUS:", "").strip()
        elif line.startswith("RATIONALE:"):
            rationale = line.replace("RATIONALE:", "").strip()
    return status, rationale


def _parse_full_assessment(response: str, objectives: list[str]) -> dict:
    status = "Not Implemented"
    rationale = ""
    objective_findings = []

    lines = response.strip().split("\n")
    in_findings = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("STATUS:"):
            status = stripped.replace("STATUS:", "").strip()
        elif stripped.startswith("RATIONALE:"):
            rationale = stripped.replace("RATIONALE:", "").strip()
        elif stripped == "FINDINGS:":
            in_findings = True
        elif in_findings and "|" in stripped:
            parts = [p.strip() for p in stripped.split("|")]
            if len(parts) >= 2:
                objective_findings.append({
                    "objective": parts[0],
                    "met": parts[1].upper() if len(parts) > 1 else "UNMET",
                    "note": parts[2] if len(parts) > 2 else "",
                })

    return {
        "status": status,
        "rationale": rationale,
        "objective_findings": objective_findings,
    }


def _apply_ssp_odp_values(project_id: str, set_parameters: dict[str, str], db: Session):
    """
    Pre-fill ODP values from SSP set-parameters where the DB row exists
    but has no value yet.
    """
    from db.models import ProjectODP
    for param_id, value in set_parameters.items():
        row = db.query(ProjectODP).filter(
            ProjectODP.project_id == project_id,
            ProjectODP.param_id == param_id,
            (ProjectODP.value.is_(None)) | (ProjectODP.value == ""),
        ).first()
        if row:
            row.value = value
    db.commit()


def _extract_text(filename: str, content: bytes) -> str:
    filename = filename.lower()
    if filename.endswith(".pdf"):
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(content))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    elif filename.endswith(".docx"):
        import docx
        doc = docx.Document(io.BytesIO(content))
        return "\n".join(p.text for p in doc.paragraphs)
    return content.decode("utf-8", errors="ignore")


def _summarize(results: list[dict]) -> dict:
    total = len(results)
    impl     = sum(1 for r in results if r["status"] == "Implemented")
    partial  = sum(1 for r in results if r["status"] == "Partially Implemented")
    not_impl = sum(1 for r in results if r["status"] == "Not Implemented")
    inherited = sum(1 for r in results if r["status"] == "Inherited")
    na        = sum(1 for r in results if r["status"] == "Not Applicable")
    planned   = sum(1 for r in results if r["status"] == "Planned")
    in_scope  = total - inherited - na
    return {
        "total": total,
        "implemented": impl,
        "partially_implemented": partial,
        "not_implemented": not_impl,
        "inherited": inherited,
        "not_applicable": na,
        "planned": planned,
        "in_scope": in_scope,
        "compliance_percentage": round(impl / in_scope * 100, 1) if in_scope else 0,
    }


def _serialize_gap(row: Gap) -> dict:
    return {
        "id": row.id,
        "control_id": row.control_id,
        "family": row.family,
        "title": row.title,
        "gap_status": row.gap_status,
        "rationale": row.rationale,
        "objective_findings": json.loads(row.objective_findings or "[]"),
        "cve_refs": json.loads(row.cve_refs or "[]"),
    }

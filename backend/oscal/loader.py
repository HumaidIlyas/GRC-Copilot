"""
OSCAL Loader — parses the NIST 800-53 Rev 5.2.0 OSCAL catalog at startup.

Extracts from the catalog:
  - Control statements and supplemental guidance  (800-53)
  - Assessment objectives and methods             (800-53A)
  - Organization-Defined Parameters (ODPs)        (800-53A)

Catalog path resolution order:
  1. OSCAL_CATALOG_PATH env var
  2. backend/oscal/NIST_SP-800-53_rev5_catalog.json   (new v5.2.0 file)
  3. backend/oscal/nist-800-53-rev5-catalog.json       (legacy filename)
"""

import json
import os
from pathlib import Path
from typing import Optional

_HERE = Path(__file__).parent

_CANDIDATE_PATHS = [
    Path(os.getenv("OSCAL_CATALOG_PATH", "")) if os.getenv("OSCAL_CATALOG_PATH") else None,
    _HERE / "NIST_SP-800-53_rev5_catalog.json",
    _HERE / "nist-800-53-rev5-catalog.json",
    # also check project root in case user placed it there
    _HERE.parent.parent / "NIST_SP-800-53_rev5_catalog.json",
]

def _find_catalog() -> Optional[Path]:
    for p in _CANDIDATE_PATHS:
        if p and p.exists():
            return p
    return None


# ── Baseline control ID lists ─────────────────────────────────────────────────
# Source: NIST SP 800-53B

BASELINES: dict[str, list[str]] = {
    "Low": [
        "ac-1","ac-2","ac-3","ac-7","ac-8","ac-14","ac-17","ac-18","ac-19","ac-20","ac-22",
        "at-1","at-2","at-3","at-4",
        "au-1","au-2","au-3","au-4","au-5","au-6","au-8","au-9","au-11","au-12",
        "ca-1","ca-2","ca-3","ca-5","ca-6","ca-7","ca-9",
        "cm-1","cm-2","cm-4","cm-5","cm-6","cm-7","cm-8","cm-10","cm-11",
        "cp-1","cp-2","cp-3","cp-4","cp-9","cp-10",
        "ia-1","ia-2","ia-3","ia-4","ia-5","ia-6","ia-7","ia-8","ia-11",
        "ir-1","ir-2","ir-4","ir-5","ir-6","ir-7","ir-8",
        "ma-1","ma-2","ma-4","ma-5","ma-6",
        "mp-1","mp-2","mp-6","mp-7",
        "pe-1","pe-2","pe-3","pe-4","pe-5","pe-6","pe-8","pe-9","pe-10","pe-11","pe-12",
        "pe-13","pe-14","pe-15","pe-16","pe-17",
        "pl-1","pl-2","pl-4","pl-8",
        "ps-1","ps-2","ps-3","ps-4","ps-5","ps-6","ps-7","ps-8","ps-9",
        "ra-1","ra-2","ra-3","ra-5","ra-7",
        "sa-1","sa-2","sa-3","sa-4","sa-5","sa-8","sa-9","sa-10","sa-11","sa-21",
        "sc-1","sc-5","sc-7","sc-12","sc-13","sc-15","sc-20","sc-21","sc-22","sc-23","sc-28","sc-39",
        "si-1","si-2","si-3","si-4","si-5","si-12","si-16",
        "sr-1","sr-2","sr-3","sr-5","sr-6","sr-8","sr-10","sr-11","sr-12",
    ],
}

BASELINES["Moderate"] = BASELINES["Low"] + [
    "ac-2.1","ac-2.2","ac-2.3","ac-2.4","ac-4","ac-5","ac-6","ac-6.1","ac-6.2","ac-6.5",
    "ac-6.9","ac-6.10","ac-11","ac-12","ac-17.1","ac-17.2","ac-17.3","ac-17.4",
    "au-2.3","au-6.1","au-6.3","au-9.2","au-10","au-12.1","au-12.3","au-14",
    "ca-2.1","ca-2.2","ca-3.6","ca-7.1","ca-8",
    "cm-2.2","cm-2.3","cm-3","cm-3.2","cm-6.1","cm-7.1","cm-7.2","cm-8.1","cm-8.2",
    "cm-8.3","cm-9","cm-12",
    "cp-2.1","cp-2.2","cp-2.3","cp-2.5","cp-2.8","cp-4.1","cp-4.2","cp-6","cp-7","cp-8",
    "ia-2.1","ia-2.2","ia-2.5","ia-2.8","ia-4.4","ia-5.1","ia-5.2","ia-5.3","ia-5.6",
    "ia-5.7","ia-12",
    "ir-3","ir-3.2","ir-4.1","ir-4.2","ir-6.1","ir-10",
    "pe-3.1","pe-6.1","pe-11.1","pe-13.1","pe-13.2","pe-13.3","pe-14.1","pe-15.1",
    "pl-9","pl-10","pl-11",
    "ra-3.1","ra-5.2","ra-5.4","ra-5.5",
    "sa-4.1","sa-4.2","sa-4.9","sa-4.10","sa-9.1","sa-9.2","sa-15","sa-16","sa-17",
    "sc-2","sc-3","sc-4","sc-7.3","sc-7.4","sc-7.5","sc-7.7","sc-7.8","sc-7.18",
    "sc-8","sc-8.1","sc-10","sc-17","sc-18","sc-19","sc-24","sc-28.1",
    "si-2.2","si-3.1","si-3.2","si-4.2","si-4.4","si-4.5","si-6","si-7","si-7.1","si-7.7",
    "si-8","si-8.1","si-8.2","si-10",
]

BASELINES["High"] = BASELINES["Moderate"]  # Placeholder — extend as needed


# ── In-memory caches ──────────────────────────────────────────────────────────

_catalog_cache: Optional[dict] = None   # control_id -> control dict
_odp_cache: Optional[dict] = None       # control_id -> list of ODP param dicts


# ── Public API ────────────────────────────────────────────────────────────────

def load_catalog() -> dict:
    """Load and cache the OSCAL catalog. Returns empty dict if file not found."""
    global _catalog_cache, _odp_cache
    if _catalog_cache is not None:
        return _catalog_cache

    catalog_path = _find_catalog()
    if not catalog_path:
        print("[OSCAL] WARNING: Catalog not found. Searched:")
        for p in _CANDIDATE_PATHS:
            if p:
                print(f"  {p}")
        _catalog_cache = {}
        _odp_cache = {}
        return _catalog_cache

    with open(catalog_path) as f:
        raw = json.load(f)

    control_index: dict = {}
    odp_index: dict = {}

    for group in raw.get("catalog", {}).get("groups", []):
        family = group.get("id", "").upper()
        for control in group.get("controls", []):
            _index_control(control, family, control_index, odp_index)
            for enhancement in control.get("controls", []):
                _index_control(enhancement, family, control_index, odp_index)

    _catalog_cache = control_index
    _odp_cache = odp_index
    print(f"[OSCAL] Loaded {len(control_index)} controls, "
          f"{sum(len(v) for v in odp_index.values())} ODPs from {catalog_path.name}")
    return _catalog_cache


def get_control(control_id: str) -> Optional[dict]:
    catalog = load_catalog()
    return catalog.get(control_id.lower())


def get_baseline_controls(baseline: str) -> list[dict]:
    """Return full control objects for all controls in a baseline."""
    catalog = load_catalog()
    ids = BASELINES.get(baseline, BASELINES["Low"])
    return [ctrl for cid in ids if (ctrl := catalog.get(cid.lower()))]


def get_control_odps(control_id: str) -> list[dict]:
    """
    Return ODP parameter definitions for a single control.

    Each ODP dict has:
      param_id          e.g. "ac-02_odp.01"
      label             e.g. "time period"
      required_definition  prose from guidelines
      is_choice         True if the param has a select/choice list
      choices           list of choice strings (empty if not is_choice)
      how_many          "one" | "one-or-more" (only relevant when is_choice)
    """
    if _odp_cache is None:
        load_catalog()
    return (_odp_cache or {}).get(control_id.lower(), [])


def get_baseline_evidence_items(baseline: str) -> list[dict]:
    """
    Return EXAMINE assessment-method objects for all controls in a baseline.
    Used to generate the Evidence Request List.

    Each item: {control_id, family, title, artifacts}
    artifacts is a deduplicated list of document/record descriptions.
    """
    catalog = load_catalog()
    # Re-parse parts for examine objects — stored separately from main index
    if _odp_cache is None:
        return []

    # We need to re-read examine objects; they aren't cached in ctrl_index.
    # Use a lazy cache on this function.
    return _build_evidence_items(baseline, catalog)


def _build_evidence_items(baseline: str, catalog: dict) -> list[dict]:
    """Build evidence items by re-scanning the catalog for EXAMINE method objects."""
    catalog_path = _find_catalog()
    if not catalog_path:
        return []

    with open(catalog_path) as f:
        raw = json.load(f)

    ids = set(BASELINES.get(baseline, BASELINES["Low"]))
    items = []

    for group in raw.get("catalog", {}).get("groups", []):
        family = group.get("id", "").upper()
        all_controls = group.get("controls", [])
        # include enhancements
        expanded = []
        for ctrl in all_controls:
            expanded.append(ctrl)
            expanded.extend(ctrl.get("controls", []))

        for ctrl in expanded:
            cid = ctrl.get("id", "").lower()
            if cid not in ids:
                continue
            artifacts = []
            for part in ctrl.get("parts", []):
                if part.get("name") != "assessment-method":
                    continue
                method_type = next(
                    (p["value"] for p in part.get("props", [])
                     if p.get("name") == "method"),
                    ""
                )
                if method_type.upper() != "EXAMINE":
                    continue
                for sub in part.get("parts", []):
                    prose = sub.get("prose", "").strip()
                    if prose:
                        # Split on newlines — NVD prose often has multiple items
                        for line in prose.split("\n"):
                            line = line.strip()
                            if line and line not in artifacts:
                                artifacts.append(line)
            if artifacts:
                items.append({
                    "control_id": cid.upper(),
                    "family": family,
                    "title": ctrl.get("title", ""),
                    "artifacts": artifacts,
                })

    return items


def get_baseline_odps(baseline: str) -> dict[str, list[dict]]:
    """Return {control_id: [odp, ...]} for all controls in a baseline."""
    ids = BASELINES.get(baseline, BASELINES["Low"])
    return {cid: odps for cid in ids if (odps := get_control_odps(cid))}


# ── Internal indexing ─────────────────────────────────────────────────────────

def _index_control(control: dict, family: str, ctrl_index: dict, odp_index: dict):
    cid = control.get("id", "").lower()
    title = control.get("title", "")
    statement = _extract_statement(control)

    guidance = ""
    assessment_objectives = []

    for part in control.get("parts", []):
        name = part.get("name", "")
        if name == "guidance":
            guidance = part.get("prose", "") or " ".join(
                p.get("prose", "") for p in part.get("parts", []) if "prose" in p
            )
        elif name == "assessment-objective":
            assessment_objectives = _extract_objectives(part)

    ctrl_index[cid] = {
        "id": cid,
        "family": family,
        "title": title,
        "statement": statement,
        "guidance": guidance[:500],
        "assessment_objectives": assessment_objectives,
    }

    # Extract ODPs — params tagged class=sp800-53a
    odps = []
    for param in control.get("params", []):
        if not any(
            prop.get("name") == "label" and prop.get("class") == "sp800-53a"
            for prop in param.get("props", [])
        ):
            continue

        guidelines = [g["prose"] for g in param.get("guidelines", []) if "prose" in g]
        select = param.get("select", {})
        choices = select.get("choice", [])

        odps.append({
            "param_id": param.get("id", ""),
            "label": param.get("label", ""),
            "required_definition": guidelines[0] if guidelines else "",
            "is_choice": bool(choices),
            "choices": choices,
            "how_many": select.get("how-many", "one"),
        })

    if odps:
        odp_index[cid] = odps


def _extract_statement(control: dict) -> str:
    for part in control.get("parts", []):
        if part.get("name") == "statement":
            return _flatten_part(part)
    return ""


def _flatten_part(part: dict, depth: int = 0) -> str:
    lines = []
    if prose := part.get("prose"):
        lines.append("  " * depth + prose)
    for sub in part.get("parts", []):
        lines.append(_flatten_part(sub, depth + 1))
    return "\n".join(lines)


def _extract_objectives(part: dict, depth: int = 0) -> list[str]:
    """Recursively collect all leaf assessment-objective prose strings."""
    objectives = []
    if prose := part.get("prose"):
        objectives.append(prose.strip())
    for sub in part.get("parts", []):
        if sub.get("name") == "assessment-objective":
            objectives.extend(_extract_objectives(sub, depth + 1))
    return objectives

"""
OSCAL SSP Parser — fetches and parses FedRAMP OSCAL System Security Plan JSON.

Supports:
  - Remote URL (raw GitHub, GSA FedRAMP repo, any public OSCAL SSP)
  - Local file path (for testing)

Extracts:
  - System metadata (name, description, boundary)
  - Software components and CPE identifiers (for NVD CVE queries)
  - Control implementations (by-component statements per control)
  - set-parameters (ODP values already defined by the org)

OSCAL SSP spec: https://pages.nist.gov/OSCAL/concepts/layer/implementation/ssp/
"""

import json
import httpx
from pathlib import Path
from typing import Optional


def fetch_ssp(source: str) -> dict:
    """
    Load an OSCAL SSP from a URL or local file path.
    Returns the parsed JSON dict, or raises on failure.
    """
    if source.startswith("http://") or source.startswith("https://"):
        try:
            with httpx.Client(timeout=30, follow_redirects=True) as client:
                resp = client.get(source)
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPError as e:
            raise ValueError(f"Failed to fetch SSP from URL: {e}")
    else:
        path = Path(source)
        if not path.exists():
            raise FileNotFoundError(f"SSP file not found: {source}")
        with open(path) as f:
            return json.load(f)


def parse_ssp(raw: dict) -> dict:
    """
    Parse a raw OSCAL SSP JSON dict into a structured summary used by the app.

    Returns:
        metadata:               system name, description, boundary
        components:             list of software component dicts (name, type, cpe)
        implemented_controls:   {control_id: implementation_text}
        control_statuses:       {control_id: status_string}
                                status values: inherited | not-applicable | planned |
                                               partial | implemented | alternative
        set_parameters:         {param_id: value_string}
    """
    ssp = raw.get("system-security-plan", raw)  # handle with or without top-level key

    metadata = _parse_metadata(ssp)
    components = _parse_components(ssp)
    implemented_controls = _parse_control_implementations(ssp)
    control_statuses = _parse_control_statuses(ssp)
    set_parameters = _parse_set_parameters(ssp)

    return {
        "metadata": metadata,
        "components": components,
        "implemented_controls": implemented_controls,
        "control_statuses": control_statuses,
        "set_parameters": set_parameters,
    }


def fetch_and_parse(source: str) -> dict:
    """Convenience: fetch + parse in one call."""
    raw = fetch_ssp(source)
    return parse_ssp(raw)


# ── Internal parsers ──────────────────────────────────────────────────────────

def _iter(obj) -> list:
    """Return iterable values from either a list or an OSCAL 1.0-style id-keyed dict."""
    if isinstance(obj, dict):
        return list(obj.values())
    return obj if isinstance(obj, list) else []


def _parse_metadata(ssp: dict) -> dict:
    meta = ssp.get("metadata", {})
    chars = ssp.get("system-characteristics", {})

    return {
        "title": meta.get("title", ""),
        "system_name": chars.get("system-name", meta.get("title", "")),
        "description": chars.get("description", ""),
        "security_sensitivity_level": chars.get("security-sensitivity-level", ""),
        "system_ids": [
            sid.get("id", "") for sid in chars.get("system-ids", [])
        ],
    }


def _parse_components(ssp: dict) -> list[dict]:
    """
    Extract software/service components from system-implementation.components.
    Returns list of {name, type, cpe, description}.
    CPE values are used to query NVD.
    """
    impl = ssp.get("system-implementation", {})
    components = []

    for comp in _iter(impl.get("components", [])):
        comp_type = (comp.get("type") or comp.get("component-type", "")).lower()

        # Collect CPE identifiers from props
        cpes = [
            p["value"] for p in _iter(comp.get("props", []))
            if isinstance(p, dict) and p.get("name") in ("software-identifier", "cpe") and p.get("value", "").startswith("cpe")
        ]

        # Use title/description as keyword fallback for NVD if no CPE
        title = comp.get("title", "")
        description = comp.get("description", "")

        components.append({
            "name": title,
            "type": comp_type,
            "cpes": cpes,
            "description": description[:200],
            "search_keyword": title,  # used for NVD keyword search when no CPE
        })

    return components


def _parse_control_implementations(ssp: dict) -> dict[str, str]:
    """
    Extract implemented-requirements from control-implementation.
    Returns {control_id (lowercase): combined_implementation_text}.

    Handles both top-level by-components and nested statements.
    """
    ctrl_impl = ssp.get("control-implementation", {})
    result: dict[str, str] = {}

    for req in ctrl_impl.get("implemented-requirements", []):
        control_id = req.get("control-id", "").lower()
        texts: list[str] = []

        # Direct by-components on the requirement
        for bycomp in _iter(req.get("by-components", [])):
            desc = bycomp.get("description", "").strip()
            if desc:
                texts.append(desc)

        # Nested statements → by-components (statements can be list or id-keyed dict)
        for stmt in _iter(req.get("statements", [])):
            for bycomp in _iter(stmt.get("by-components", [])):
                desc = bycomp.get("description", "").strip()
                if desc:
                    texts.append(desc)

        if texts:
            result[control_id] = "\n\n".join(texts)

    return result


def _parse_control_statuses(ssp: dict) -> dict[str, str]:
    """
    Extract implementation-status for each control in the SSP.
    Returns {control_id (lowercase): status_string}.

    Checks three locations OSCAL/FedRAMP use for this field:
      1. implemented-requirement.implementation-status.state  (OSCAL 1.1+)
      2. implemented-requirement.props[name=implementation-status].value  (FedRAMP ns)
      3. implemented-requirement.by-components[].implementation-status.state
    """
    ctrl_impl = ssp.get("control-implementation", {})
    result: dict[str, str] = {}

    for req in ctrl_impl.get("implemented-requirements", []):
        control_id = req.get("control-id", "").lower()
        if not control_id:
            continue

        status = ""

        # 1. OSCAL 1.1+ direct field
        status_obj = req.get("implementation-status", {})
        if status_obj:
            status = status_obj.get("state", "").lower()

        # 2. FedRAMP props/annotations pattern (ns: https://fedramp.gov/ns/oscal)
        if not status:
            for prop in _iter(req.get("props", [])) + _iter(req.get("annotations", [])):
                if isinstance(prop, dict) and prop.get("name") == "implementation-status":
                    status = prop.get("value", "").lower()
                    break

        # 3. by-components level
        if not status:
            for bycomp in _iter(req.get("by-components", [])):
                status_obj = bycomp.get("implementation-status", {})
                if status_obj:
                    status = status_obj.get("state", "").lower()
                    break
                for prop in _iter(bycomp.get("props", [])) + _iter(bycomp.get("annotations", [])):
                    if isinstance(prop, dict) and prop.get("name") == "implementation-status":
                        status = prop.get("value", "").lower()
                        break
                if status:
                    break

        if status:
            result[control_id] = status

    return result


def _parse_set_parameters(ssp: dict) -> dict[str, str]:
    """
    Extract set-parameters from control-implementation (top-level and per-requirement).
    Returns {param_id: value_string}.
    """
    ctrl_impl = ssp.get("control-implementation", {})
    result: dict[str, str] = {}

    # Top-level set-parameters
    for sp in ctrl_impl.get("set-parameters", []):
        param_id = sp.get("param-id", "")
        values = sp.get("values", [])
        if param_id and values:
            result[param_id] = ", ".join(str(v) for v in values)

    # Per-requirement set-parameters
    for req in ctrl_impl.get("implemented-requirements", []):
        for sp in req.get("set-parameters", []):
            param_id = sp.get("param-id", "")
            values = sp.get("values", [])
            if param_id and values:
                result[param_id] = ", ".join(str(v) for v in values)

    return result


def extract_nvd_search_terms(parsed_ssp: dict) -> list[str]:
    """
    Return a deduplicated list of search terms to use for NVD CVE queries.
    Prefers CPE names; falls back to component titles.
    """
    terms: list[str] = []
    for comp in parsed_ssp.get("components", []):
        if comp["cpes"]:
            terms.extend(comp["cpes"])
        elif comp["search_keyword"]:
            terms.append(comp["search_keyword"])
    return list(dict.fromkeys(terms))  # deduplicate preserving order

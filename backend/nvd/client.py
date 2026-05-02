"""
NVD (National Vulnerability Database) API client.

Queries the NIST NVD REST API v2 for CVEs related to a system's software components.
Free to use — no API key required for basic queries (2,000 req/day, 5 req/30s).
Set NVD_API_KEY in env for higher rate limits (50 req/30s).

API docs: https://nvd.nist.gov/developers/vulnerabilities
"""

import os
import asyncio
import httpx
from typing import Optional

NVD_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0"
_API_KEY = os.getenv("NVD_API_KEY")

# NVD rate limits: 5 req/30s without key, 50 req/30s with key
_DELAY = 6.5 if not _API_KEY else 0.7


def _headers() -> dict:
    h = {"Accept": "application/json"}
    if _API_KEY:
        h["apiKey"] = _API_KEY
    return h


def fetch_cves_for_keyword(keyword: str, max_results: int = 20) -> list[dict]:
    """
    Search NVD for CVEs matching a keyword (product name, vendor, etc.).
    Returns a list of simplified CVE dicts.
    """
    params = {
        "keywordSearch": keyword,
        "resultsPerPage": min(max_results, 2000),
    }
    return _query(params)


def fetch_cves_for_cpe(cpe_name: str, max_results: int = 20) -> list[dict]:
    """
    Search NVD for CVEs affecting a specific CPE (Common Platform Enumeration) name.
    Example: cpe:2.3:a:apache:log4j:2.14.1:*:*:*:*:*:*:*
    """
    params = {
        "cpeName": cpe_name,
        "resultsPerPage": min(max_results, 2000),
    }
    return _query(params)


def fetch_cves_for_components(components: list[str], max_per_component: int = 10) -> list[dict]:
    """
    Fetch CVEs for a list of software component names/keywords.
    Deduplicates by CVE ID. Adds a small delay between requests to respect rate limits.
    """
    seen: set[str] = set()
    results: list[dict] = []

    for component in components:
        cves = fetch_cves_for_keyword(component, max_results=max_per_component)
        for cve in cves:
            if cve["id"] not in seen:
                seen.add(cve["id"])
                results.append(cve)
        if len(components) > 1:
            import time
            time.sleep(_DELAY)

    return results


def _query(params: dict) -> list[dict]:
    """Execute a single NVD API query and return simplified CVE list."""
    try:
        with httpx.Client(timeout=30) as client:
            resp = client.get(NVD_BASE, params=params, headers=_headers())
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        print(f"[NVD] API error: {e}")
        return []
    except Exception as e:
        print(f"[NVD] Unexpected error: {e}")
        return []

    vulnerabilities = data.get("vulnerabilities", [])
    return [_simplify(v["cve"]) for v in vulnerabilities if "cve" in v]


def _simplify(cve: dict) -> dict:
    """
    Flatten NVD CVE response into a lean dict with only what the app needs.

    Returns:
        id:          CVE ID (e.g. "CVE-2021-44228")
        description: English description
        cvss_score:  float base score (None if unavailable)
        severity:    CRITICAL / HIGH / MEDIUM / LOW / NONE
        cwes:        list of CWE IDs (e.g. ["CWE-917", "CWE-502"])
        published:   ISO date string
        url:         NVD detail page URL
    """
    cve_id = cve.get("id", "")

    # Description (English)
    description = next(
        (d["value"] for d in cve.get("descriptions", []) if d.get("lang") == "en"),
        ""
    )

    # CVSS score — prefer v3.1, fall back to v3.0, then v2
    cvss_score = None
    severity = "NONE"
    metrics = cve.get("metrics", {})
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        if key in metrics and metrics[key]:
            cvss_data = metrics[key][0].get("cvssData", {})
            cvss_score = cvss_data.get("baseScore")
            severity = cvss_data.get("baseSeverity", "NONE")
            break

    # CWE IDs
    cwes: list[str] = []
    for weakness in cve.get("weaknesses", []):
        for desc in weakness.get("description", []):
            val = desc.get("value", "")
            if val.startswith("CWE-"):
                cwes.append(val)

    return {
        "id": cve_id,
        "description": description[:500],  # cap for prompt injection into Claude
        "cvss_score": cvss_score,
        "severity": severity,
        "cwes": list(set(cwes)),
        "published": cve.get("published", "")[:10],
        "url": f"https://nvd.nist.gov/vuln/detail/{cve_id}",
    }


def group_cves_by_control(cves: list[dict]) -> dict[str, list[dict]]:
    """
    Given a list of CVE dicts, return {control_id: [cve, ...]} mapping
    using the CWE→800-53 mapping table.
    """
    from nvd.cwe_mapping import controls_for_cwe
    grouped: dict[str, list[dict]] = {}
    for cve in cves:
        for cwe in cve.get("cwes", []):
            for control_id in controls_for_cwe(cwe):
                grouped.setdefault(control_id, [])
                if cve not in grouped[control_id]:
                    grouped[control_id].append(cve)
    return grouped

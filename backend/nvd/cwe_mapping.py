"""
CWE → NIST 800-53 Rev 5 control mapping.

Derived from NIST's CPRT (Crosswalk) and MITRE's published CWE→800-53 mappings.
Each CWE maps to one or more 800-53 control IDs (lowercase, matching catalog keys).

Used to enrich gap assessment: CVEs that carry a given CWE automatically flag
the associated 800-53 controls as having known weaknesses.
"""

# CWE_ID (str) → list of 800-53 control IDs
CWE_TO_CONTROLS: dict[str, list[str]] = {
    # Input validation & injection
    "CWE-20":  ["si-10"],                        # Improper Input Validation
    "CWE-22":  ["ac-3", "si-10"],                # Path Traversal
    "CWE-78":  ["si-10", "cm-7"],                # OS Command Injection
    "CWE-79":  ["si-10", "sc-8"],                # XSS
    "CWE-89":  ["si-10"],                        # SQL Injection
    "CWE-90":  ["si-10"],                        # LDAP Injection
    "CWE-94":  ["si-10", "cm-7"],                # Code Injection
    "CWE-611": ["si-10"],                        # XXE
    "CWE-917": ["si-10"],                        # Expression Language Injection
    "CWE-502": ["si-10", "cm-7"],                # Deserialization of Untrusted Data

    # Memory safety
    "CWE-119": ["si-16"],                        # Buffer Overflow (general)
    "CWE-120": ["si-16"],                        # Classic Buffer Copy
    "CWE-121": ["si-16"],                        # Stack Buffer Overflow
    "CWE-122": ["si-16"],                        # Heap Buffer Overflow
    "CWE-125": ["si-16"],                        # Out-of-bounds Read
    "CWE-190": ["si-16"],                        # Integer Overflow
    "CWE-362": ["si-16"],                        # Race Condition
    "CWE-416": ["si-16"],                        # Use After Free
    "CWE-787": ["si-16"],                        # Out-of-bounds Write

    # Authentication & credentials
    "CWE-255": ["ia-5"],                         # Credential Management Errors
    "CWE-259": ["ia-5"],                         # Hard-coded Password
    "CWE-287": ["ia-2", "ia-5"],                 # Improper Authentication
    "CWE-306": ["ia-2", "ac-3"],                 # Missing Authentication
    "CWE-307": ["ac-7", "ia-5"],                 # Brute Force (no lockout)
    "CWE-521": ["ia-5"],                         # Weak Password Requirements
    "CWE-522": ["ia-5", "sc-28"],                # Insufficiently Protected Credentials
    "CWE-798": ["ia-5"],                         # Hard-coded Credentials
    "CWE-1392":["ia-5"],                         # Use of Default Credentials

    # Access control & authorization
    "CWE-250": ["ac-6"],                         # Execution with Unnecessary Privileges
    "CWE-269": ["ac-6"],                         # Improper Privilege Management
    "CWE-284": ["ac-3", "ac-6"],                 # Improper Access Control
    "CWE-285": ["ac-3"],                         # Improper Authorization
    "CWE-639": ["ac-3"],                         # IDOR
    "CWE-732": ["ac-3", "ac-6"],                 # Incorrect Permission Assignment
    "CWE-862": ["ac-3"],                         # Missing Authorization
    "CWE-863": ["ac-3"],                         # Incorrect Authorization

    # Cryptography & data protection
    "CWE-311": ["sc-8", "sc-28"],                # Missing Encryption
    "CWE-312": ["sc-28"],                        # Cleartext Storage
    "CWE-319": ["sc-8"],                         # Cleartext Transmission
    "CWE-326": ["sc-12", "sc-13"],               # Inadequate Encryption Strength
    "CWE-327": ["sc-12", "sc-13"],               # Broken Algorithm
    "CWE-328": ["sc-13"],                        # Weak Hash
    "CWE-330": ["sc-13"],                        # Use of Insufficiently Random Values
    "CWE-338": ["sc-13"],                        # Weak PRNG

    # Certificate & TLS
    "CWE-295": ["sc-23", "ia-8"],                # Improper Certificate Validation
    "CWE-296": ["sc-23"],                        # Improper Certificate Chain Validation
    "CWE-297": ["sc-23"],                        # Improper Hostname Verification
    "CWE-298": ["sc-23"],                        # Improper Certificate Expiry Check

    # Information exposure
    "CWE-200": ["ac-3", "si-12", "sc-8"],        # Information Exposure
    "CWE-209": ["si-11"],                        # Error Message Contains Sensitive Info
    "CWE-532": ["au-9", "si-12"],                # Info Exposure Through Log Files

    # Web-specific
    "CWE-352": ["sc-8", "sc-23"],                # CSRF
    "CWE-601": ["sc-8"],                         # URL Redirect
    "CWE-918": ["sc-7", "cm-7"],                 # SSRF
    "CWE-1004":["sc-8"],                         # Sensitive Cookie Without HttpOnly
    "CWE-1021":["sc-8"],                         # Clickjacking

    # File handling
    "CWE-434": ["si-3", "cm-7"],                 # Unrestricted File Upload
    "CWE-73":  ["ac-3", "si-10"],                # External Control of File Name/Path

    # Resource management
    "CWE-400": ["sc-5"],                         # Resource Exhaustion / DoS
    "CWE-770": ["sc-5"],                         # Allocation Without Limits
    "CWE-404": ["sc-5"],                         # Improper Resource Shutdown

    # Patch / configuration
    "CWE-1188":["cm-6", "si-2"],                 # Insecure Default Initialization
    "CWE-16":  ["cm-6"],                         # Configuration
}


def controls_for_cwe(cwe_id: str) -> list[str]:
    """Return 800-53 control IDs for a given CWE ID string (e.g. 'CWE-79')."""
    return CWE_TO_CONTROLS.get(cwe_id.upper(), [])


def controls_for_cwes(cwe_ids: list[str]) -> set[str]:
    """Return deduplicated set of 800-53 control IDs for a list of CWE IDs."""
    result: set[str] = set()
    for cwe in cwe_ids:
        result.update(controls_for_cwe(cwe))
    return result

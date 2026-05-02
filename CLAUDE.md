# GRC Copilot — Project Briefing

## What this is
A copilot tool for GRC analysts working on NIST 800-53 compliance.
It does NOT replace analysts — it assists with the repetitive documentation footwork.
Target users are GRC analysts, not developers.

## Three core features
1. **SSP Assistant** — drafts control implementation statements (FedRAMP SSP template)
2. **Gap Assessment** — maps uploaded docs against the NIST baseline, flags gaps
3. **POA&M Generator** — drafts POA&M entries from gap findings

## Key architectural decisions
- NIST 800-53 Rev 5 only (no other frameworks in v1)
- OSCAL catalog is ingested at backend startup — all Claude API calls are grounded in real control text from it
- SQLite for local persistence (no cloud, no login)
- All exports are Excel (.xlsx)
- Backend: FastAPI (Python) | Frontend: Next.js + Tailwind

## How to run
```bash
# Backend (first time: run setup.sh first)
cd backend && source venv/bin/activate && uvicorn main:app --reload

# Frontend
cd frontend && npm run dev
```

## OSCAL catalog
Must be downloaded before the backend works:
  backend/oscal/nist-800-53-rev5-catalog.json
The setup.sh script downloads it automatically.

## What's NOT built yet (frontend)
- /ssp, /gap, /poam pages are stubs — only the dashboard (/) exists
- No project creation UI yet
- API is fully functional; frontend pages need to be built

## Spec
Full decisions log is in SPEC.md.

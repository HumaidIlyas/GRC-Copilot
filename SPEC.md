# GRC Copilot — Specification

## Problem Statement

GRC analysts spend a significant portion of their time on repetitive, language-heavy documentation
tasks. This tool does not replace their judgement — it accelerates the footwork so they can focus
on higher-value decisions.

## Target Users

- GRC Analysts performing NIST 800-53 compliance assessments
- Skill level: Domain experts, not necessarily technical/developers

## Framework Scope

- **NIST 800-53 Rev 5.2.0** only (expandable later)
- Supports Low, Moderate, and High baselines
- OSCAL catalog includes both 800-53 control statements and 800-53A assessment procedures (objectives, methods, ODPs)

---

## Data Sources

The system is grounded in two public data sources rather than analyst-uploaded documents.
This solves the blank-slate problem — analysts don't need pre-existing documentation.

### Source 1: FedRAMP OSCAL SSPs
- Publicly available authorized system security plans (GSA GitHub, CSP-published packages)
- Parsed as structured OSCAL JSON — control implementations, software components, ODP set-parameters
- Represents what the system **claims** to implement

### Source 2: NIST NVD (National Vulnerability Database)
- Free REST API (`services.nvd.nist.gov/rest/json/cves/2.0`)
- Queried by software keyword or CPE name — returns CVEs with CVSS scores and CWE tags
- CWE tags mapped to 800-53 controls via `backend/nvd/cwe_mapping.py` (~60 CWEs covered)
- Represents what is **actually broken** in that system's components

The tension between claimed implementation (SSP) and real vulnerabilities (NVD) is exactly
what a gap assessment surfaces.

---

## Core Features (v1)

### 1. SSP Assistant

**What it does:**
- Analyst creates a project with system info and baseline selection
- Optionally provides a FedRAMP OSCAL SSP URL — ODP values auto-populated from `set-parameters`
- Claude drafts implementation statements per control, injecting ODP values so output is specific not generic
- Analyst reviews, edits, and marks each statement as reviewed/approved

**API endpoints:**
- `POST /api/ssp/projects` — create project
- `GET  /api/ssp/projects` — list projects
- `POST /api/ssp/projects/{id}/draft` — trigger Claude drafting for all baseline controls
- `GET  /api/ssp/projects/{id}/controls` — list drafted controls
- `PATCH /api/ssp/projects/{id}/controls/{ctrl}` — save analyst edits
- `GET  /api/export/projects/{id}/ssp` — download .xlsx

---

### 2. ODP Tracking

**What it does:**
- Extracts all Organization-Defined Parameters from the 800-53A catalog for the project's baseline
  (417 ODPs for Low, 581 for Moderate)
- If an OSCAL SSP is provided, pre-fills values from its `set-parameters` block automatically
- Analyst fills remaining values; undefined ODPs are flagged
- All defined ODP values are injected into every downstream Claude prompt

**Why it matters:**
Without ODPs: *"The system may not patch in time."*
With ODPs: *"The SSP states a 90-day patch SLA but CVE-2024-XXXX has been unpatched for 120 days — SI-2 not implemented."*

**API endpoints:**
- `POST /api/odp/projects/{id}/initialize` — populate ODP rows from catalog
- `GET  /api/odp/projects/{id}/params` — list params (supports `?undefined_only=true`, `?control_id=`)
- `GET  /api/odp/projects/{id}/params/summary` — completion stats by family
- `PATCH /api/odp/projects/{id}/params/{odp_id}` — save a value
- `GET  /api/export/projects/{id}/odp` — download .xlsx

---

### 3. Gap Assessment

**What it does:**
- Fetches and parses the FedRAMP OSCAL SSP from the project's stored URL
- Queries NVD for CVEs affecting the system's software components (optional, ~30s per component)
- Pre-fills any ODP values found in the SSP's `set-parameters`
- Parses `implementation-status` from the SSP for each control (inherited, not-applicable, planned, etc.)
- **Three-tier pre-filter** before any Claude call:
  1. `inherited` / `not-applicable` / `planned` in SSP → auto-labelled, no Claude
  2. No SSP statement at all → "Not Implemented", no Claude
  3. Has a statement → send to Claude for quality judgment
- Controls needing Claude are sent as a **single Anthropic Message Batch** — one API call, results polled every 5s
- Claude returns: `status` + `rationale` + per-objective `findings[]` via tool use (structured JSON, no regex)
- Compliance percentage calculated against **in-scope controls only** (excludes Inherited and N/A)
- Legacy file-upload endpoint retained at `POST /gap/projects/{id}/assess`

**Gap status values:**
- `Implemented` — SSP statement satisfies all assessment objectives
- `Partially Implemented` — SSP statement partially addresses the control
- `Not Implemented` — no statement in SSP, or statement is inadequate
- `Inherited` — control satisfied by underlying platform (e.g. AWS GovCloud)
- `Not Applicable` — control does not apply to this system
- `Planned` — gap acknowledged, remediation planned but not yet complete

**API endpoints:**
- `POST /api/gap/projects/{id}/assess-from-ssp` — primary: SSP + NVD pipeline
- `POST /api/gap/projects/{id}/assess` — legacy: file upload
- `GET  /api/gap/projects/{id}/gaps` — list results with CVE refs and objective findings
- `GET  /api/export/projects/{id}/gap` — download .xlsx

---

### 4. Evidence Request List

**What it does:**
- Pulls EXAMINE assessment-method objects from the 800-53A catalog for every control in the baseline
- Each EXAMINE object lists the specific documents/records/artifacts an assessor needs to review
- Deduplicates artifact types across controls; groups by artifact name with relevant controls listed
- `?gaps_only=true` filters to only controls with a non-Implemented status

**API endpoints:**
- `GET /api/export/projects/{id}/evidence-request` — download .xlsx (two sheets: per-control list + deduplicated artifact index)

---

### 5. POA&M Generator

**What it does:**
- Pulls all non-Implemented gaps for the project
- For each gap, Claude drafts a POA&M entry with CVE evidence injected into the prompt
- Uses tool use (structured output) — returns `weakness_description`, `risk_level`, `remediation_steps`, `milestones` as clean fields, no parsing
- Analyst reviews, edits inline, and updates status (open / in_progress / closed)

**API endpoints:**
- `POST /api/poam/projects/{id}/generate` — draft all POA&M entries
- `GET  /api/poam/projects/{id}/items` — list items
- `PATCH /api/poam/projects/{id}/items/{item_id}` — save analyst edits
- `GET  /api/export/projects/{id}/poam` — download .xlsx

---

## LLM Architecture

**Not RAG.** All data is structured and addressable by control ID — no chunking, no embeddings, no vector DB. Vector search is only warranted for unstructured document inputs (PDF/DOCX), not for OSCAL SSPs where control IDs are explicitly tagged.

```
Gap assessment pipeline:
  Parse SSP → extract control_statuses + implemented_controls
       ↓
  Pre-filter (no Claude):
    inherited / not-applicable / planned → auto-labelled
    no SSP statement                    → Not Implemented
       ↓
  Remaining controls (have statements):
  SSP implementation statement  ──┐
  800-53A control text + objectives├──→ Anthropic Message Batch (single API call)
  Relevant CVEs from NVD          │         └── tool use, structured JSON
  ODP values (org-defined)        ─┘              └── returns typed dict, no regex
       ↓
  Poll batch every 5s → collect results → write to DB
```

### Vendor-agnostic LLM layer (`backend/llm/client.py`)

Switch provider with a single env var — no code changes:

| `LLM_VENDOR` | Backend | Auth |
|---|---|---|
| `anthropic` | Direct Anthropic API | `ANTHROPIC_API_KEY` |
| `vertex` | Claude on GCP Vertex AI | GCP service account (no key) |
| `openai` | OpenAI API | `OPENAI_API_KEY` |
| `gemini` | Google Generative AI | `GEMINI_API_KEY` |

### Task-based model routing (cost control)

| Task | Anthropic / Vertex | OpenAI | Gemini |
|---|---|---|---|
| `classify` — gap status, risk level | claude-haiku-4-5 | gpt-4o-mini | gemini-1.5-flash |
| `draft` — SSP statements, POA&M | claude-sonnet-4-6 | gpt-4o | gemini-1.5-pro |

Estimated cost per full Moderate baseline (~270 controls): **~$0.05–0.10** after pre-filtering (typically only 10–30% of controls have SSP statements and need Claude).

### Structured output

Two modes:

**`complete_structured(prompt, schema, task)`** — single real-time call, used for SSP drafting and POA&M generation. Uses each vendor's native tool use / function calling:
- Anthropic/Vertex: `tool_choice={"type": "tool"}` forces JSON response
- OpenAI: `function_call={"name": ...}`
- Gemini: `FunctionDeclaration` + `function_call` in response parts
- Fallback: text-based parsing if structured call fails

**`complete_batch_structured(requests, task)`** — Anthropic Message Batch, used for gap assessment. Submits all controls needing Claude in a single API call, polls for completion. Falls back to threaded `complete_structured` for non-Anthropic vendors. Custom IDs are sanitized (`^[a-zA-Z0-9_-]{1,64}$`) and mapped back to original control IDs.

---

## Data Model

```
Project
├── id, name, system_description, system_boundary
├── data_classification    Low / Moderate / High
├── baseline               Low / Moderate / High
├── oscal_ssp_url          optional — FedRAMP OSCAL SSP source
├── created_at, updated_at
│
├── odp_values[]
│     control_id, param_id, label, required_definition
│     value (analyst-filled), is_choice, choices (JSON)
│
├── controls[]
│     control_id, family, title
│     implementation_statement (Claude draft, analyst-editable)
│     status: draft | reviewed | approved
│
├── gaps[]
│     control_id, family, title
│     gap_status: Implemented | Partially Implemented | Not Implemented
│     │             | Inherited | Not Applicable | Planned
│     rationale (one sentence)
│     objective_findings (JSON: [{objective, met, note}])
│     cve_refs (JSON: ["CVE-2024-XXXX"])
│
└── poam_items[]
      control_id
      weakness_description, risk_level: High | Medium | Low
      remediation_steps, milestones
      cve_refs (JSON)
      status: open | in_progress | closed
```

---

## File Structure

```
GRC_Copilot/
├── SPEC.md
├── CLAUDE.md
├── DEPLOY_PLAN.md              full step-by-step GCP deployment guide (with gotchas)
├── docker-compose.yml          local multi-container dev
├── cloudbuild.yaml             GCP CI/CD: GitHub → Artifact Registry → Cloud Run
├── gcp_setup.sh                one-time GCP infrastructure setup
├── .gcloudignore
│
├── backend/
│   ├── main.py                 FastAPI app, CORS (reads FRONTEND_URL env), auth middleware, startup hooks
│   ├── auth.py                 Firebase/GIP ID token verification middleware (google-auth)
│   ├── requirements.txt
│   ├── Dockerfile              downloads OSCAL catalog at build time via curl
│   ├── .env.example
│   ├── setup.sh                downloads OSCAL catalog (local dev)
│   │
│   ├── db/
│   │   └── models.py           SQLAlchemy: Project, Control, Gap, PoamItem, ProjectODP
│   │
│   ├── oscal/
│   │   ├── loader.py           catalog parser — controls, objectives, ODPs, evidence items
│   │   ├── ssp_parser.py       FedRAMP OSCAL SSP fetcher + parser
│   │   └── NIST_SP-800-53_rev5_catalog.json  (downloaded — not in git)
│   │
│   ├── nvd/
│   │   ├── client.py           NVD API CVE fetcher (keyword + CPE)
│   │   └── cwe_mapping.py      CWE → 800-53 control mapping (~60 CWEs)
│   │
│   ├── llm/
│   │   └── client.py           vendor-agnostic: anthropic/vertex/openai/gemini
│   │                           complete() + complete_structured() + complete_batch_structured()
│   │                           Batch API (anthropic only) + threaded fallback for other vendors
│   │
│   └── routes/
│       ├── ssp.py              project CRUD + SSP drafting
│       ├── odp.py              ODP init, list, update, summary
│       ├── gap.py              SSP+NVD assessment + legacy file upload
│       ├── poam.py             POA&M generate + edit
│       └── export.py           .xlsx: SSP, Gap, POA&M, ODP, Evidence Request
│
└── frontend/
    ├── Dockerfile
    ├── next.config.ts          output: standalone (for Docker)
    ├── package.json            Next.js 16.2.2, React 19, Tailwind 4, firebase, jose
    ├── proxy.ts                route protection — checks grc_session cookie (Next.js 16: replaces middleware.ts)
    │
    ├── lib/
    │   ├── api.ts              typed API client; attaches Firebase ID token to every request
    │   └── firebase.ts         Firebase/GIP SDK initialisation (reads NEXT_PUBLIC_FIREBASE_* vars)
    │
    └── app/
        ├── layout.tsx          nav bar + Sign Out button
        ├── globals.css
        ├── page.tsx            Dashboard — project list + create modal
        ├── login/page.tsx      Google sign-in page (Firebase signInWithPopup)
        ├── ssp/page.tsx        draft/review/edit controls, family filter, export
        ├── odp/page.tsx        ODP table, progress bar, inline edit (free text + choice)
        ├── gap/page.tsx        SSP URL input, run assessment, results + expandable objectives
        ├── poam/page.tsx       POA&M items, risk/status filter, inline edit, export
        ├── components/
        │   └── SignOutButton.tsx  client component — Firebase signOut + clears session cookie
        └── api/auth/
            ├── session/route.ts  POST — verifies Firebase token, sets httpOnly grc_session cookie (jose JWT)
            └── logout/route.ts   DELETE — clears grc_session cookie
```

---

## GCP Deployment

```
User Browser
    │  (must be signed in via Google Identity Platform)
    │
    ├── Cloud Run ─────────────── Next.js frontend (containerized standalone build)
    │       ├── proxy.ts ───────→ checks grc_session cookie; redirects to /login if missing
    │       └── Firebase SDK ──→ Google Identity Platform — issues ID tokens
    │
    └── Cloud Run ─────────────── FastAPI backend
            ├── auth.py ────────→ verifies Firebase ID token on every request (google-auth)
            ├── Vertex AI ──────→ Claude claude-sonnet-4-6 / Haiku (LLM_VENDOR=vertex)
            │                     Auth: GCP service account IAM — no API keys in config
            ├── Cloud SQL ──────→ PostgreSQL (DATABASE_URL env var, same SQLAlchemy code)
            └── Secret Manager → ANTHROPIC_API_KEY, NVD_API_KEY, DATABASE_URL,
                                  SESSION_SECRET, FIREBASE_API_KEY

CI/CD: cloudbuild.yaml
  GitHub push to main
    → docker build backend + frontend (frontend bakes NEXT_PUBLIC_FIREBASE_* at build time)
    → push to Artifact Registry
    → gcloud run deploy (both services)

Setup: ./gcp_setup.sh <project-id> <region>
  Enables 7 APIs (incl. identitytoolkit.googleapis.com for Identity Platform),
  creates service account + IAM roles, creates Secret Manager secrets,
  provisions Cloud SQL instance.
```

### GCP Infrastructure Status (as of 2026-05-01)

Project ID: `grc-copilot-495021` | Region: `us-central1`

| Resource | Name | Status |
|---|---|---|
| Cloud SQL | `grc-copilot-db` (PostgreSQL 15, db-f1-micro) | Created |
| Database | `grccopilot` | Created |
| Artifact Registry | `grc-copilot` | Created |
| Service Account | `grc-copilot-sa@grc-copilot-495021.iam.gserviceaccount.com` | Created |
| Secret Manager | `anthropic-api-key`, `nvd-api-key`, `db-url`, `session-secret`, `firebase-api-key` | Created (empty) |
| APIs Enabled | Cloud Run, Cloud SQL, Secret Manager, Artifact Registry, Cloud Build, Vertex AI, Identity Platform | Done |

**Remaining to complete deployment:**
1. ~~Create Cloud SQL user (`grccopilot` with password)~~ ✓ Done 2026-05-01
2. Fill Secret Manager values — status below
3. Enable Identity Platform in GCP Console → add Google provider → get Firebase API key
4. Create OAuth 2.0 credentials (for Google sign-in redirect)
5. Build + deploy backend to Cloud Run → note URL hash → update `_HASH` in `cloudbuild.yaml`
6. Deploy frontend
7. Connect Cloud Build to GitHub repo (CI/CD)

**Secret Manager status (as of 2026-05-01):**

| Secret | Status | Command to fill |
|---|---|---|
| `db-url` | ✓ Stored | — |
| `session-secret` | ✓ Stored (auto-generated) | — |
| `anthropic-api-key` | Pending — add when ready | `echo -n 'sk-ant-...' \| gcloud secrets versions add anthropic-api-key --data-file=- --project=grc-copilot-495021` |
| `nvd-api-key` | Pending — optional, get free key at nvd.nist.gov/developers/request-an-api-key | `echo -n 'YOUR_NVD_KEY' \| gcloud secrets versions add nvd-api-key --data-file=- --project=grc-copilot-495021` |
| `firebase-api-key` | ✓ Stored | — |

**To pause Cloud SQL when not demoing** (saves ~$10/month):
```bash
gcloud sql instances patch grc-copilot-db --activation-policy=NEVER --project=grc-copilot-495021
# Resume before demoing:
gcloud sql instances patch grc-copilot-db --activation-policy=ALWAYS --project=grc-copilot-495021
```

---

## UX Flow

```
1. Dashboard     → Create project (name, boundary, baseline, optional SSP URL)
2. ODP Tracking  → Initialize → fill parameter values → feeds all downstream analysis
3. SSP Assistant → Draft All → review/edit each control → Export .xlsx
4. Gap Assessment→ Enter SSP URL → Run Assessment (SSP + NVD) → review per-objective findings → Export .xlsx
                   Evidence Request → auto-generated artifact list → Export .xlsx
5. POA&M         → Generate → review/edit entries → update status → Export .xlsx
```

Each stage is independently usable — analyst can start at any step.

---

## Out of Scope (v1)

- Frameworks other than NIST 800-53
- Multi-user collaboration / role-based access
- Integration with GRC platforms (eMASS, Vanta, etc.)
- Continuous monitoring or automated evidence collection
- Tech stack analysis via DISA STIGs / CISA SCuBA (planned for v2)

---

## Decisions Log

| Question | Decision |
|---|---|
| Project persistence | SQLite locally; Cloud SQL (PostgreSQL) on GCP via DATABASE_URL env var |
| Export format | Excel (.xlsx) for all outputs — standard in federal/enterprise GRC |
| SSP template | FedRAMP SSP Appendix A column structure |
| NIST data source | OSCAL catalog v5.2.0 — 800-53 statements + 800-53A objectives + ODPs |
| System data source | FedRAMP OSCAL SSPs (public) + NVD CVE API (public, free) |
| Gap assessment approach | Structured data extraction + direct context injection — not RAG, no embeddings |
| Why not vector search | OSCAL SSPs are structured — control IDs are explicitly tagged, no fuzzy matching needed. Vector search is only relevant for unstructured PDF/DOCX inputs |
| LLM output format | Claude tool use / OpenAI function calling — structured JSON, no regex parsing |
| LLM vendor | Vendor-agnostic via LLM_VENDOR env var (anthropic / vertex / openai / gemini) |
| Gap assessment throughput | Anthropic Message Batch API — all controls in one call, not sequential or threaded. Avoids rate limits entirely |
| Pre-filtering | Controls with no SSP statement auto-marked Not Implemented without any Claude call. Controls marked inherited/N/A/planned in SSP also skip Claude. Typically 70–90% of controls are pre-filtered |
| Cost control | Task-based model routing — classify → Haiku, draft → Sonnet. Pre-filtering cuts Claude calls by ~70–90% vs naive per-control approach |
| Inheritance handling | SSP parser extracts `implementation-status` from 3 OSCAL locations (direct field, FedRAMP props, by-components). Compliance % calculated against in-scope controls only |
| GCP LLM path | LLM_VENDOR=vertex uses AnthropicVertex client — GCP IAM auth, no hardcoded keys |
| Cloud platform | GCP: Cloud Run (both services), Vertex AI, Cloud SQL, Secret Manager |
| CI/CD | Cloud Build triggered on GitHub push to main — cloudbuild.yaml |
| Anthropic SDK version | Requires ≥0.40.0 for Message Batch API support (`client.messages.batches`) |
| Authentication | Google Identity Platform (GIP) — enterprise IDP via GCP Console, not Firebase Console. Satisfies two non-negotiable requirements: (1) IDP with domain restriction + audit logs, (2) Google Native Login |
| Auth token flow | Firebase client SDK issues ID tokens → stored in httpOnly `grc_session` cookie (jose JWT) → backend verifies with `google.oauth2.id_token.verify_firebase_token` |
| Next.js 16 proxy | `middleware.ts` deprecated in Next.js 16 — renamed to `proxy.ts`, export named `proxy`. Route protection must use this convention or it silently does nothing |
| Frontend session | Custom session cookie (jose HS256, 24h TTL) checked by `proxy.ts`. Firebase SDK holds live ID token for API calls — `auth.currentUser.getIdToken()` called per request |
| CORS | Backend reads `FRONTEND_URL` env var for allowed origin. Defaults to `http://localhost:3000` so local dev works without config |
| OSCAL in Docker | `.gcloudignore` excludes local JSON files from Cloud Build upload. Dockerfile downloads the OSCAL catalog via `curl` at image build time instead |

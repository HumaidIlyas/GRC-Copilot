# GRC Copilot

A copilot tool for GRC analysts working on NIST 800-53 FedRAMP compliance. It handles the repetitive documentation footwork — gap assessment against an existing OSCAL SSP and automated POA&M generation — so analysts can focus on judgement rather than paperwork.

---

## Architecture

![GRC Copilot Pipeline](GRC_Copilot_Pipeline.png)

---

## Component Overview

### GitHub — Source Control
The entire codebase lives in this public repository. It contains the Python FastAPI backend, the Next.js 16 frontend, two Dockerfiles, and `cloudbuild.yaml` which defines the full CI/CD pipeline. A `.dockerignore` file prevents secrets and local databases from being baked into Docker images.

### GCP Cloud Build — CI/CD Pipeline
Triggered manually via `gcloud builds submit`, Cloud Build executes the pipeline defined in `cloudbuild.yaml`. The backend and frontend are built as separate Docker images in parallel. The frontend build receives `NEXT_PUBLIC_*` environment variables as build arguments at image creation time — these are baked into the Next.js bundle — with the Firebase API key injected securely via Secret Manager's `secretEnv` mechanism. Each image is tagged with the commit SHA for traceability, pushed to Artifact Registry, then deployed to Cloud Run.

### Artifact Registry — Image Storage
Stores versioned Docker images for both services under `us-central1-docker.pkg.dev/grc-copilot-495021/grc-copilot`. Each build produces a `COMMIT_SHA`-tagged image alongside a `latest` tag, giving the ability to roll back to any prior deployment.

### Secret Manager — Credentials Store
All sensitive values are stored here and never committed to source control. The backend mounts `openai-api-key`, `db-url`, and `nvd-api-key` at Cloud Run deploy time via `--set-secrets`. The frontend mounts `session-secret` and `firebase-api-key`. The Firebase API key is also injected into the frontend Docker build via `availableSecrets` so Next.js can embed it at build time.

### Firebase Auth — Identity Provider
Google OAuth 2.0 is used as the identity provider. After a user signs in, Firebase issues a signed JWT (ID token) with a one-hour expiry that is auto-refreshed by the Firebase client SDK. The token is exchanged for an encrypted session cookie stored in the browser. On every subsequent API call, the frontend retrieves a fresh token via `getIdToken()` and sends it as a `Bearer` header.

### Cloud Run — Frontend (grc-copilot-ui)
A Next.js 16 application serving the analyst-facing UI. The login page uses `window.location.href` for post-login navigation to bypass Next.js's RSC prefetch cache, which would otherwise serve a cached redirect and loop the user back to the login screen. All API calls go through `apiFetch` and `apiDownload` helpers that attach the Firebase ID token to every request. The two primary pages are the Gap Assessment page (OSCAL SSP URL input, optional CVE toggle, results grid) and the POA&M page (generate, inline edit, export).

### Cloud Run — Backend (grc-copilot-api)
A FastAPI application running on Python 3.12 with a 900-second request timeout to accommodate long-running assessments. Incoming requests pass through CORS middleware (origin-restricted to the frontend URL) and then an auth middleware that short-circuits `OPTIONS` requests for CORS preflight, verifies the Firebase ID token against the configured GCP project, and optionally enforces an email domain allowlist. The NIST 800-53 Rev 5 OSCAL catalog (1,196 controls, 1,458 ODPs) is loaded into memory at startup and used to ground every LLM prompt in real control text.

### Gap Assessment Engine
Accepts an OSCAL SSP URL, fetches and parses it using a parser that handles both OSCAL 1.0 (dict-keyed `statements` and `by-components`) and OSCAL 1.1 (array format). Optionally queries the NVD for CVEs affecting the system's software components. Controls are pre-filtered by SSP status — `inherited`, `not-applicable`, and `planned` controls are resolved without an LLM call. Remaining in-scope controls are assessed by the LLM against their NIST 800-53 assessment objectives and any CVE evidence, using the batch processing path for efficiency.

### POA&M Engine
Queries the gap results for controls with status `Not Implemented`, `Partially Implemented`, or `Planned` — skipping `Inherited` and `Not Applicable` controls which require no remediation. For each gap, the LLM drafts a structured POA&M entry containing a weakness description, a risk level (High / Medium / Low), numbered remediation steps, and a 30/60/90-day milestone timeline. Analysts can edit each entry inline before exporting.

### LLM Abstraction Layer
A single `llm/client.py` module routes all LLM calls based on the `LLM_VENDOR` environment variable — no code changes required to switch providers. Four vendors are supported: Anthropic (claude-haiku-4-5 for classify tasks, claude-sonnet-4-6 for draft tasks, with native Message Batches API), OpenAI (gpt-4.1-mini / gpt-4.1, currently active), Vertex AI (Claude on GCP via `us-east5` region), and Gemini (gemini-1.5-flash / gemini-1.5-pro). For non-Anthropic vendors, batch processing falls back to a `ThreadPoolExecutor` with 5 concurrent workers. All structured output uses native function calling / tool use per vendor.

### Cloud SQL — PostgreSQL Database
A PostgreSQL 14 instance (`grc-copilot-db`, `us-central1`) connected to Cloud Run via the Cloud SQL Proxy (`--add-cloudsql-instances`). Stores five tables: `projects`, `controls`, `gaps`, `poam_items`, and `project_odps`. The instance can be paused between sessions with `--activation-policy=NEVER` to eliminate idle compute costs, and resumed with `--activation-policy=ALWAYS`.

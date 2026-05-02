# GRC Copilot — Deployment Plan

## What We're Building

Right now the app runs on your laptop. Two terminal windows, two local processes.
The goal is to move both to Google Cloud so they run on Google's servers, accessible
at a real public URL, always on, with Google login protecting access.

```
TODAY (local)                        AFTER DEPLOYMENT (GCP)
─────────────────────                ──────────────────────────────────────────
localhost:3000  ←── browser          https://grc-copilot-ui-xxx.run.app  ←── browser
     │                                         │
localhost:8000  ←── frontend calls  https://grc-copilot-api-xxx.run.app  ←── frontend calls
     │                                         │
grc_copilot.db  ←── SQLite file     Cloud SQL PostgreSQL  ←── managed DB on GCP
```

---

## Existing Files and What They Do

| File | Purpose | Status |
|---|---|---|
| `gcp_setup.sh` | One-time infrastructure setup — enables APIs, creates Cloud SQL, Artifact Registry, service account, Secret Manager secrets | Exists — missing Cloud SQL user creation and Identity Platform API (`identitytoolkit.googleapis.com`) |
| `cloudbuild.yaml` | CI/CD pipeline — builds Docker images, pushes to Artifact Registry, deploys to Cloud Run on every `git push` | Exists — has a `<hash>` placeholder for the backend URL that must be fixed |
| `backend/Dockerfile` | Packages FastAPI into a Docker image | Exists — missing OSCAL catalog download |
| `frontend/Dockerfile` | Packages Next.js into a Docker image (two-stage build) | Exists — correct |
| `docker-compose.yml` | Runs both services locally together | Exists — local dev only, not used on GCP |
| `.gcloudignore` | Tells Cloud Build what NOT to upload | Exists — correctly excludes `node_modules`, `.env`, OSCAL JSONs |

---

## Concepts You Need to Know First

### Docker
A Docker image is a self-contained package of your app — the operating system layer,
Python/Node.js runtime, all dependencies, and your code bundled together. Like a
shipping container. It runs identically on your laptop or Google's servers.

A `Dockerfile` is the recipe for building that image. You run `docker build` and it
follows the recipe step by step.

### Cloud Run
Google's service for running Docker containers. You give it a Docker image and it:
- Starts your app on Google's servers
- Gives it a public HTTPS URL
- Scales to zero when nobody is using it (you pay nothing at idle)
- Scales up automatically when traffic comes in

You don't manage servers. You just give it an image.

### Artifact Registry
Google's private storage for Docker images. Like GitHub but for Docker images.
Cloud Build pushes images here; Cloud Run pulls from here.

### Cloud SQL
Google's managed PostgreSQL database. Your SQLAlchemy code doesn't change —
the only difference is the `DATABASE_URL` environment variable points to
Cloud SQL instead of a local SQLite file.

### Secret Manager
Google's vault for API keys and passwords. Secrets are never in your code or
Docker images. Cloud Run fetches them at startup and injects them as environment
variables.

### Cloud Build
Google's CI/CD service. Connected to your GitHub repo, it triggers automatically
on every `git push` to `main`. It builds your Docker images and deploys them to
Cloud Run. The pipeline is defined in `cloudbuild.yaml`.

---

## Phase 1 — Deploy Without Auth

Get the app running on GCP first. Add auth in Phase 2.

---

### Step 1 — Prerequisites on Your Laptop

**Install the gcloud CLI:**
```bash
# macOS
brew install google-cloud-sdk

# Authenticate
gcloud auth login
gcloud auth application-default login
```

This lets you control GCP from your terminal. `gcloud auth login` opens a browser
window where you sign in with your Google account.

**Install Docker Desktop:**
Download from docker.com. You need this to build and test Docker images locally
before pushing to GCP.

**Create a GCP project:**
1. Go to console.cloud.google.com
2. Click the project dropdown at the top → "New Project"
3. Name it `grc-copilot`, note the Project ID (may get a number suffix like `grc-copilot-123456`)
4. Enable billing (required for Cloud Run + Cloud SQL)

---

### Step 2 — Run gcp_setup.sh

This script does the one-time infrastructure setup. Run it once from your laptop.

```bash
# From the project root
chmod +x gcp_setup.sh
./gcp_setup.sh YOUR_PROJECT_ID us-central1
```

**What it creates:**
- Enables 6 GCP APIs (Cloud Run, Cloud SQL, Secret Manager, Artifact Registry, Cloud Build, Vertex AI)
- Creates an Artifact Registry repo: `us-central1-docker.pkg.dev/YOUR_PROJECT_ID/grc-copilot`
- Creates a service account `grc-copilot-sa` with permissions to access secrets, Cloud SQL, and Vertex AI
- Creates a Cloud SQL PostgreSQL 15 instance called `grc-copilot-db` (takes ~5 minutes)
- Creates a database called `grccopilot` inside that instance
- Creates 3 empty secrets: `anthropic-api-key`, `nvd-api-key`, `db-url`

**After it runs, you need to add the missing Cloud SQL user manually:**
```bash
# Create a database user
gcloud sql users create grccopilot \
  --instance=grc-copilot-db \
  --password=PICK_A_STRONG_PASSWORD

# The DATABASE_URL will be:
# postgresql://grccopilot:PICK_A_STRONG_PASSWORD@/grccopilot?host=/cloudsql/YOUR_PROJECT_ID:us-central1:grc-copilot-db
```

---

### Step 3 — Fill in Secret Manager Values

The setup script created empty secrets. Now fill them with real values.
These are injected into Cloud Run as environment variables at runtime.
They never appear in your code or Docker images.

```bash
# Anthropic API key
echo -n "sk-ant-api03-..." | gcloud secrets versions add anthropic-api-key --data-file=-

# NVD API key (optional — get free one at nvd.nist.gov/developers/request-an-api-key)
echo -n "your-nvd-key" | gcloud secrets versions add nvd-api-key --data-file=-

# Database URL (the PostgreSQL connection string from Step 2)
echo -n "postgresql://grccopilot:PASSWORD@/grccopilot?host=/cloudsql/YOUR_PROJECT_ID:us-central1:grc-copilot-db" \
  | gcloud secrets versions add db-url --data-file=-
```

---

### Step 4 — Fix the Backend Dockerfile (OSCAL Catalog)

**The problem:**
The `.gcloudignore` file excludes `**/oscal/*.json` from Cloud Build uploads.
This means the OSCAL catalog never makes it into the Docker image.
The backend will start but fail to load any controls.

**The fix:**
Download the catalog inside the Dockerfile during the build step, so it's baked
into the image.

**Edit `backend/Dockerfile`** — add `curl` install and catalog download:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Bake the OSCAL catalog into the image at build time
# The .gcloudignore excludes local JSON files, so we fetch it here instead
RUN curl -fsSL \
  "https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json" \
  -o oscal/NIST_SP-800-53_rev5_catalog.json

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
```

---

### Step 5 — Fix the Frontend API URL

**The problem:**
`frontend/lib/api.ts` currently hardcodes `http://localhost:8000` as the backend URL.
On Cloud Run the backend lives at a GCP URL, not localhost.

**The fix:**
Make it read from an environment variable.

**Edit `frontend/lib/api.ts`** — change the base URL line from:
```ts
const BASE_URL = "http://localhost:8000/api"
```
To:
```ts
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api"
```

The `??` fallback means local development still works without setting any env var.
On GCP, `NEXT_PUBLIC_API_URL` is injected at Docker build time via `--build-arg`
in `cloudbuild.yaml`.

---

### Step 6 — Fix the Backend URL in cloudbuild.yaml

**The problem:**
Line 66 of `cloudbuild.yaml` has a placeholder:
```yaml
NEXT_PUBLIC_API_URL=https://${_BACKEND_SVC}-<hash>-uc.a.run.app/api
```
The `<hash>` part is a random string GCP assigns to your Cloud Run service.
You only know it after the first deployment.

**Two-step process:**

**First deployment** — do it manually from the terminal to get the URL:
```bash
# Deploy backend manually (first time only)
gcloud run deploy grc-copilot-api \
  --image=us-central1-docker.pkg.dev/YOUR_PROJECT_ID/grc-copilot/backend:latest \
  --region=us-central1 \
  --platform=managed \
  --allow-unauthenticated \
  --set-env-vars=LLM_VENDOR=vertex,GCP_PROJECT_ID=YOUR_PROJECT_ID,GCP_REGION=us-central1 \
  --set-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest,NVD_API_KEY=nvd-api-key:latest,DATABASE_URL=db-url:latest \
  --service-account=grc-copilot-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

GCP will output a URL like:
```
Service URL: https://grc-copilot-api-abc123xyz-uc.a.run.app
```

**Update cloudbuild.yaml** — replace `<hash>` with the actual hash (`abc123xyz`):
```yaml
NEXT_PUBLIC_API_URL=https://grc-copilot-api-abc123xyz-uc.a.run.app/api
```

After this, Cloud Build handles all future deployments automatically.

---

### Step 7 — Connect Cloud Build to GitHub

This wires up the CI/CD pipeline so every `git push` triggers a deployment.

1. Go to GCP Console → Cloud Build → Triggers
2. Click "Connect Repository"
3. Authenticate with GitHub, select your `GRC_Copilot` repo
4. Click "Create Trigger"
5. Set branch filter to `^main$`
6. Set build config to `cloudbuild.yaml`

**From this point forward:**
```
git add .
git commit -m "any change"
git push origin main
    → Cloud Build triggers automatically
    → Builds both Docker images (~3 minutes)
    → Deploys both to Cloud Run (~1 minute)
    → New version live
```

---

### Step 8 — Verify the Deployment

```bash
# Check backend health
curl https://YOUR_BACKEND_URL/health

# Should return:
# {"status":"ok","llm":{"vendor":"vertex",...}}
```

Open the frontend URL in the browser. The app should be fully functional.

---

## Phase 2 — Add Google Authentication

### Non-Negotiable Requirements

Two requirements that cannot be changed:

**Requirement 1: Authentication System via IDP**
An Identity Provider (IDP) is a central service that manages user identities, enforces
access policies, and issues tokens that other services trust. Every access attempt goes
through the IDP — you don't scatter auth logic across your code.

**Requirement 2: Google Native Login**
Users sign in with their existing Google account — the standard "Sign in with Google"
button. No new username/password to manage.

**How we satisfy both with one service: Google Identity Platform (GIP)**

Google Identity Platform is GCP's enterprise-grade IDP. It is NOT the same as plain
Firebase Auth (though it uses the same Firebase SDK underneath). It is configured
directly through the GCP Console, not the Firebase Console.

| What you need | What GIP provides |
|---|---|
| IDP (Requirement 1) | Central identity service with domain restrictions, MFA enforcement, audit logs via Cloud Audit Logs |
| Google Native Login (Requirement 2) | Standard Google OAuth sign-in — the same "Sign in with Google" button your users already know |
| Backend token verification | Issues standard Google ID tokens — backend verifies with Google's public key, no custom logic |
| Audit trail | Every sign-in event logged to Cloud Audit Logs automatically |

The difference from plain Firebase Auth: GIP is the enterprise version with IDP-grade
controls (domain restriction, MFA, audit logs). Firebase Auth is the consumer version
without those controls.

---

### Step 9 — Set Up Google Identity Platform

**Enable the API:**
```bash
gcloud services enable identitytoolkit.googleapis.com --project=YOUR_PROJECT_ID
```

**Configure in GCP Console:**
1. Go to console.cloud.google.com → search "Identity Platform" in the top bar
   (Do NOT go to console.firebase.google.com — that is the consumer Firebase Console)
2. Click "Enable Identity Platform"
3. Click "Add a Provider" → select "Google"
4. Click "Save"

You now have an enterprise IDP in your GCP project. It issues standard Google ID tokens.

**Restrict access to your organization's domain (IDP policy enforcement):**
1. In Identity Platform → Settings → User Actions
2. Under "Authorized Domains" — add your Cloud Run frontend URL:
   `grc-copilot-ui-abc123-uc.a.run.app`
3. To restrict sign-in to a specific Google Workspace domain (e.g. your company's email):
   This is enforced at the backend token-verification step — verify the `hd` (hosted domain)
   claim in the Google ID token payload (Step 11 below).

**Enable MFA (optional but recommended for an IDP):**
1. Identity Platform → Providers → Multi-factor authentication → Enable
2. Choose SMS or TOTP as the second factor
3. In your frontend Firebase SDK init, call `firebase.auth().settings.appVerificationDisabledForTesting = false`
   (MFA is enforced by Identity Platform automatically once enabled)

**Get your Web App credentials:**
1. GCP Console → Identity Platform → Application Setup Details
   (Or: APIs & Services → Credentials → Web Client auto-created by Identity Platform)
2. Note down:
   - `apiKey`
   - `authDomain` (format: `YOUR_PROJECT_ID.firebaseapp.com`)
   - `projectId`

These are not secret — they're embedded in the frontend JavaScript bundle.
They identify which GIP project to authenticate against — they don't grant API access.

**Create OAuth credentials for NextAuth:**
1. GCP Console → APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
2. Application type: Web application
3. Authorized redirect URIs: `https://YOUR_FRONTEND_URL/api/auth/callback/google`
4. Note down the Client ID and Client Secret

---

### Step 10 — Add NextAuth.js to the Frontend

NextAuth.js handles the OAuth flow in Next.js — the redirect to Google, the callback,
the session cookie. It uses the GIP-issued Google ID token under the hood.

**Install:**
```bash
cd frontend
npm install next-auth firebase
```

The `firebase` package is the Firebase JS SDK — even though we're using Google Identity
Platform (not Firebase), GIP uses the same SDK. It's the Google-maintained client library
for talking to Identity Platform.

**New files to create:**

`frontend/lib/firebase.ts` — Initialize the Firebase/GIP SDK:
```ts
import { initializeApp, getApps } from "firebase/app"
import { getAuth } from "firebase/auth"

const firebaseConfig = {
  apiKey:     process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId:  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
export const auth = getAuth(app)
```

`frontend/lib/auth.ts` — NextAuth configuration:
```ts
import NextAuth from "next-auth"
import GoogleProvider from "next-auth/providers/google"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      session.idToken = token.idToken as string
      return session
    },
    async jwt({ token, account }) {
      if (account) token.idToken = account.id_token
      return token
    },
  },
})
```

`frontend/app/api/auth/[...nextauth]/route.ts` — NextAuth route handler:
```ts
import { handlers } from "@/lib/auth"
export const { GET, POST } = handlers
```

`frontend/middleware.ts` — Protects every page, redirects to login if no session:
```ts
export { auth as middleware } from "@/lib/auth"

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"],
}
```

`frontend/app/login/page.tsx` — Login page with Google sign-in:
```tsx
import { signIn } from "@/lib/auth"

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-10 text-center max-w-sm w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">GRC Copilot</h1>
        <p className="text-sm text-gray-500 mb-8">Sign in to access your compliance workspace</p>
        <form action={async () => { "use server"; await signIn("google") }}>
          <button className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
            Sign in with Google
          </button>
        </form>
      </div>
    </div>
  )
}
```

**Update `frontend/lib/api.ts`** — attach the GIP-issued ID token to every API request:
```ts
import { getSession } from "next-auth/react"

async function apiFetch(path: string, options: RequestInit = {}) {
  const session = await getSession()
  return fetch(BASE_URL + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session?.idToken ? { Authorization: `Bearer ${session.idToken}` } : {}),
      ...options.headers,
    },
  })
}
```

**Add Firebase/GIP config vars to `cloudbuild.yaml`** frontend build step:
```yaml
--build-arg=NEXT_PUBLIC_FIREBASE_API_KEY=$$FIREBASE_API_KEY
--build-arg=NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT_ID.firebaseapp.com
--build-arg=NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
```

**New secrets to add to Secret Manager:**
```bash
# OAuth credentials from GCP Console → APIs & Services → Credentials
echo -n "YOUR_GOOGLE_CLIENT_ID"     | gcloud secrets versions add google-client-id --data-file=-
echo -n "YOUR_GOOGLE_CLIENT_SECRET" | gcloud secrets versions add google-client-secret --data-file=-

# Random string for signing session cookies — generate with: openssl rand -base64 32
echo -n "RANDOM_32_CHAR_STRING"     | gcloud secrets versions add nextauth-secret --data-file=-

# Firebase/GIP API key (non-secret but convenient to store here)
echo -n "YOUR_FIREBASE_API_KEY"     | gcloud secrets versions add firebase-api-key --data-file=-
```

---

### Step 11 — Add JWT Middleware to the Backend

Every request from the frontend carries a Google ID token (issued by Identity Platform)
in the `Authorization: Bearer <token>` header. The backend verifies it by checking
Google's public key server — same verification whether the token came from Firebase Auth
or Google Identity Platform, because the token format is identical.

**Optional: enforce domain restriction at the token level**
If you want only users from a specific Google Workspace domain (e.g. `@yourcompany.com`)
to have access, check the `hd` (hosted domain) claim in the token payload:
```python
payload = id_token.verify_oauth2_token(...)
if payload.get("hd") != "yourcompany.com":
    return JSONResponse(status_code=403, content={"detail": "Access restricted to company accounts"})
```
This is the backend enforcement of the IDP domain restriction policy.

**New file: `backend/auth.py`**

```python
import os
from fastapi import Request
from fastapi.responses import JSONResponse
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
ALLOWED_DOMAIN   = os.getenv("ALLOWED_DOMAIN", "")  # e.g. "yourcompany.com" — leave blank to allow all

PUBLIC_PATHS = {"/health", "/docs", "/openapi.json"}

async def auth_middleware(request: Request, call_next):
    if request.url.path in PUBLIC_PATHS:
        return await call_next(request)

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Missing token"})

    token = auth_header.split(" ", 1)[1]
    try:
        payload = id_token.verify_oauth2_token(
            token, google_requests.Request(), GOOGLE_CLIENT_ID
        )
        # IDP domain restriction — enforced here if ALLOWED_DOMAIN is set
        if ALLOWED_DOMAIN and payload.get("hd") != ALLOWED_DOMAIN:
            return JSONResponse(status_code=403, content={"detail": "Access restricted"})
        request.state.user_email = payload["email"]
        request.state.user_name  = payload.get("name", "")
    except Exception:
        return JSONResponse(status_code=401, content={"detail": "Invalid token"})

    return await call_next(request)
```

**Update `backend/main.py`** — register the middleware:
```python
from auth import auth_middleware
app.middleware("http")(auth_middleware)
```

**Install the Google auth library:**
```bash
cd backend && source venv/bin/activate
pip install google-auth
# Add to requirements.txt: google-auth>=2.0.0
```

**Add the new secrets to `cloudbuild.yaml`** in the backend deploy step:
```yaml
--set-secrets=...,GOOGLE_CLIENT_ID=google-client-id:latest
```

---

### Step 12 — Lock Down the Backend

Right now the backend Cloud Run URL is public. Anyone who knows the URL can call
your API directly, bypassing the frontend and the IDP entirely.

**Update `cloudbuild.yaml`** — change the backend deploy from:
```yaml
--allow-unauthenticated
```
To:
```yaml
--no-allow-unauthenticated
```

This means only requests with a valid Google Identity Platform token in the
`Authorization` header are accepted. Direct browser access to the backend URL
returns 403. The frontend (which goes through the IDP) is the only way in.

**Audit logs — no action required:**
Once Google Identity Platform is enabled, every sign-in event is automatically
written to Cloud Audit Logs. To view them:
1. GCP Console → Logging → Logs Explorer
2. Filter: `resource.type="identitytoolkit.googleapis.com"`
   Or: `logName="projects/YOUR_PROJECT_ID/logs/identitytoolkit.googleapis.com%2Factivity"`

This gives you a full record of who authenticated, when, and from where —
satisfying the audit trail requirement of a proper IDP.

---

## Where Every New File Lives

```
GRC_Copilot/
│
├── DEPLOY_PLAN.md                ← this file
│
├── backend/
│   ├── Dockerfile                ← MODIFIED: add curl + OSCAL catalog download
│   ├── auth.py                   ← NEW: GIP JWT verification middleware + domain restriction
│   ├── main.py                   ← MODIFIED: register auth middleware
│   └── requirements.txt          ← MODIFIED: add google-auth
│
└── frontend/
    ├── middleware.ts              ← NEW: protects all routes, redirects to /login
    ├── lib/
    │   ├── api.ts                ← MODIFIED: read API URL from env var, attach GIP token
    │   ├── auth.ts               ← NEW: NextAuth config (Google provider via GIP)
    │   └── firebase.ts           ← NEW: Firebase/GIP SDK initialization
    └── app/
        ├── api/
        │   └── auth/
        │       └── [...nextauth]/
        │           └── route.ts  ← NEW: NextAuth route handler
        └── login/
            └── page.tsx          ← NEW: login page with "Sign in with Google"
```

---

## Environment Variables — Where Each One Lives

| Variable | Where set | Used by |
|---|---|---|
| `LLM_VENDOR` | `cloudbuild.yaml` (hardcoded `vertex`) | Backend |
| `GCP_PROJECT_ID` | `cloudbuild.yaml` | Backend (Vertex AI) |
| `GCP_REGION` | `cloudbuild.yaml` | Backend (Vertex AI) |
| `ANTHROPIC_API_KEY` | Secret Manager → `anthropic-api-key` | Backend |
| `NVD_API_KEY` | Secret Manager → `nvd-api-key` | Backend |
| `DATABASE_URL` | Secret Manager → `db-url` | Backend |
| `GOOGLE_CLIENT_ID` | Secret Manager → `google-client-id` | Backend (GIP JWT verification) |
| `ALLOWED_DOMAIN` | `cloudbuild.yaml` env var (optional) | Backend (domain restriction) |
| `GOOGLE_CLIENT_SECRET` | Secret Manager → `google-client-secret` | Frontend (NextAuth) |
| `NEXTAUTH_SECRET` | Secret Manager → `nextauth-secret` | Frontend (session signing) |
| `FIREBASE_API_KEY` | Secret Manager → `firebase-api-key` | Frontend (GIP SDK init) |
| `NEXT_PUBLIC_API_URL` | `cloudbuild.yaml` build-arg | Frontend (API calls) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `cloudbuild.yaml` build-arg | Frontend (GIP SDK) |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `cloudbuild.yaml` build-arg | Frontend (GIP SDK) |

---

## Full Sequence Checklist

### Phase 1 — Deployment
- [ ] Install gcloud CLI and Docker Desktop on laptop
- [ ] Create GCP project, enable billing
- [ ] Run `./gcp_setup.sh YOUR_PROJECT_ID us-central1`
- [ ] Create Cloud SQL user + password
- [ ] Fill in Secret Manager values (Anthropic key, NVD key, DB URL)
- [ ] Edit `backend/Dockerfile` — add OSCAL catalog download
- [ ] Edit `frontend/lib/api.ts` — read API URL from env var
- [ ] Build backend Docker image and push manually (to get the Cloud Run URL)
- [ ] Deploy backend to Cloud Run manually (first time)
- [ ] Note the backend Cloud Run URL, update `cloudbuild.yaml`
- [ ] Deploy frontend to Cloud Run manually (first time)
- [ ] Verify at `https://YOUR_FRONTEND_URL` — app works
- [ ] Connect Cloud Build to GitHub repo
- [ ] Push a test commit, verify Cloud Build pipeline runs

### Phase 2 — Authentication (Google Identity Platform)
- [ ] Enable Identity Platform API: `gcloud services enable identitytoolkit.googleapis.com`
- [ ] GCP Console → Identity Platform → Enable → Add Provider → Google → Save
- [ ] Add frontend Cloud Run URL to Identity Platform Authorized Domains
- [ ] (Optional) Enable MFA in Identity Platform → Settings → Multi-factor authentication
- [ ] GCP Console → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web)
- [ ] Add redirect URI: `https://YOUR_FRONTEND_URL/api/auth/callback/google`
- [ ] Add secrets to Secret Manager: `google-client-id`, `google-client-secret`, `nextauth-secret`, `firebase-api-key`
- [ ] Install NextAuth.js + Firebase SDK: `npm install next-auth firebase`
- [ ] Create `frontend/lib/firebase.ts`
- [ ] Create `frontend/lib/auth.ts`
- [ ] Create `frontend/app/api/auth/[...nextauth]/route.ts`
- [ ] Create `frontend/middleware.ts`
- [ ] Create `frontend/app/login/page.tsx`
- [ ] Update `frontend/lib/api.ts` to attach GIP ID token
- [ ] Install `google-auth` in backend, update `requirements.txt`
- [ ] Create `backend/auth.py` (with optional domain restriction via `ALLOWED_DOMAIN`)
- [ ] Update `backend/main.py` to register auth middleware
- [ ] Update `cloudbuild.yaml`:
  - Add Firebase/GIP build-args for frontend
  - Add `GOOGLE_CLIENT_ID` secret to backend deploy
  - Change backend from `--allow-unauthenticated` to `--no-allow-unauthenticated`
- [ ] Push to main, verify Cloud Build deploys both services
- [ ] Verify Google login flow works end to end
- [ ] Verify unauthenticated backend access returns 401
- [ ] Verify audit logs appear in GCP Logging → Logs Explorer for Identity Platform events

---

## Known Gotchas (Read Before You Start)

These are the three places most likely to burn you. Not edge cases — expected friction.

---

### Gotcha 1 — Step 6: You Can't Know the Backend URL Before Deploying It

**The trap:**
The frontend Docker image needs the backend URL baked in at build time
(`NEXT_PUBLIC_API_URL`). But the URL is assigned by GCP only after the backend
is first deployed. It contains a random hash you cannot predict:
```
https://grc-copilot-api-abc123xyz-uc.a.run.app
```
So the first deployment is always a two-step manual dance:
1. Deploy the backend image manually (Step 6)
2. GCP prints the URL — copy the hash
3. Update `cloudbuild.yaml` with the actual URL
4. Then deploy the frontend

**The follow-on trap:**
If you ever delete and recreate the backend Cloud Run service, GCP assigns a new hash.
Your frontend breaks with a silent fetch/CORS error. You have to repeat Step 6.

**The clean fix:**
Map a custom domain to the backend Cloud Run service. The URL then becomes something
you control (e.g. `api.grc-copilot.yourcompany.com`) and never changes regardless of
redeployments. Worth doing if this app will live for more than a few weeks.

```bash
# After deployment, map a custom domain
gcloud run domain-mappings create \
  --service=grc-copilot-api \
  --domain=api.grc-copilot.yourcompany.com \
  --region=us-central1
```

---

### Gotcha 2 — Step 10: NextAuth.js TypeScript Won't Compile Out of the Box

**The trap:**
NextAuth's built-in `Session` and `JWT` types don't include `idToken`. The moment
you write `session.idToken` anywhere, TypeScript refuses to compile:
```
Property 'idToken' does not exist on type 'Session'
```

**The fix:**
Create a type augmentation file before writing any auth code.
Add `frontend/types/next-auth.d.ts`:
```ts
import "next-auth"
import "next-auth/jwt"

declare module "next-auth" {
  interface Session {
    idToken?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    idToken?: string
  }
}
```

**The second trap (App Router vs Pages Router):**
NextAuth v4 was designed for the Next.js Pages Router. This project uses the App Router.
The patterns are different:
- `getSession()` from `next-auth/react` only works in client components
- In server components and middleware, use the `auth()` helper from your `auth.ts`
- The login page uses a Server Action (`"use server"`) — if you get a redirect loop on
  login, it usually means `NEXTAUTH_URL` is not set or doesn't match the deployed URL

**Add `NEXTAUTH_URL` to `cloudbuild.yaml`** in the frontend deploy step:
```yaml
--set-env-vars=NEXTAUTH_URL=https://YOUR_FRONTEND_URL
```
Without this, NextAuth can't construct the correct callback URL in production and
sign-in silently fails or loops.

---

### Gotcha 3 — Step 11: The `hd` Claim Is Missing for Personal Gmail Accounts

**The trap:**
If you set `ALLOWED_DOMAIN` in `backend/auth.py` to restrict access to a specific
Google Workspace domain (e.g. `yourcompany.com`), it works by checking the `hd`
(hosted domain) claim in the Google ID token.

The problem: personal Gmail accounts (`@gmail.com`) do NOT include the `hd` claim.
So your backend check `payload.get("hd") != ALLOWED_DOMAIN` evaluates to
`None != "yourcompany.com"` → True → returns 403.

The user sees "Access restricted" with no explanation. The auth succeeded — Google
accepted their sign-in — but the backend silently rejected them.

**Two scenarios:**
- If you want to restrict to a company domain: the check is correct, but add a clear
  error message so users know *why* they're blocked
- If you want to allow personal Gmail accounts too: either leave `ALLOWED_DOMAIN` blank,
  or check email suffix instead of `hd`:

```python
# Check email domain instead of hd claim — works for both Gmail and Workspace
email = payload.get("email", "")
if ALLOWED_DOMAIN and not email.endswith(f"@{ALLOWED_DOMAIN}"):
    return JSONResponse(status_code=403, content={
        "detail": f"Access restricted to @{ALLOWED_DOMAIN} accounts"
    })
```

This is more reliable than checking `hd` and gives users a readable error message.

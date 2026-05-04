import os
from fastapi import Request
from fastapi.responses import JSONResponse
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

FIREBASE_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
ALLOWED_DOMAIN      = os.getenv("ALLOWED_DOMAIN", "")

PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}


async def auth_middleware(request: Request, call_next):
    if request.method == "OPTIONS" or request.url.path in PUBLIC_PATHS:
        return await call_next(request)

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Missing token"})

    token = auth_header.split(" ", 1)[1]
    try:
        payload = id_token.verify_firebase_token(
            token, google_requests.Request(), audience=FIREBASE_PROJECT_ID or None
        )
        if ALLOWED_DOMAIN:
            email = payload.get("email", "")
            if not email.endswith(f"@{ALLOWED_DOMAIN}"):
                return JSONResponse(
                    status_code=403,
                    content={"detail": f"Access restricted to @{ALLOWED_DOMAIN} accounts"},
                )
        request.state.user_email = payload.get("email", "")
        request.state.user_name  = payload.get("name", "")
    except Exception:
        return JSONResponse(status_code=401, content={"detail": "Invalid or expired token"})

    return await call_next(request)

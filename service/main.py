from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from autofill.attachments import resolve
from autofill.models import GenerateRequest, Profile
from autofill.orchestrator import generate_forms_and_draft
from autofill.storage import load_profile, save_profile


app = FastAPI(title="NSW Court Autofill Service", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/profile")
def get_profile() -> dict[str, Any]:
    profile = load_profile()
    if not profile:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "PROFILE_MISSING",
                "message": "Profile is not configured. Set it once via POST /profile.",
            },
        )
    return profile.model_dump()


@app.post("/profile")
def set_profile(profile: Profile) -> dict[str, str]:
    save_profile(profile)
    return {"status": "saved"}


@app.post("/generate")
def generate(request: GenerateRequest) -> dict[str, Any]:
    return generate_forms_and_draft(request)


@app.post("/intake")
def intake(request: GenerateRequest) -> dict[str, Any]:
    return generate_forms_and_draft(request)


@app.get("/attachment/{token}")
def attachment(token: str) -> FileResponse:
    path = resolve(token)
    if not path:
        raise HTTPException(status_code=404, detail="Attachment not found or expired.")
    return FileResponse(path)

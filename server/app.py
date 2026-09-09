"""
app.py - Central server for the Privacy-Preserving Vision Agent.

Run with:
    uvicorn app:app --reload --port 8000

Environment variables (all optional; defaults to an offline mock
planner so the demo works with zero external dependencies):
    VLM_BACKEND       = mock | openai_compatible | ollama
    OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL
    OLLAMA_BASE_URL, OLLAMA_MODEL

Security note: this server intentionally never persists the incoming
image beyond request handling, and logs only metadata (never raw
base64 image bytes or DOM text) to keep the "no sensitive data leaves
the client" guarantee honest end-to-end.
"""
from __future__ import annotations

import logging
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from action_schema import Action, AnalyzeRequest, AnalyzeResponse
from vlm_client import plan_action

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("privacy-agent-server")

app = FastAPI(title="Privacy-Preserving Vision Agent Server", version="0.1.0")

# Loosened for hackathon demo purposes; restrict to the extension's
# origin / your deployed domain in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/docs")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    t0 = time.time()

    if not req.image_base64.startswith("data:image"):
        raise HTTPException(400, "image_base64 must be a data URL (client-side redaction step missing?)")

    # NOTE: we deliberately never log req.image_base64 or dom text values,
    # only structural metadata, to keep an auditable privacy boundary.
    log.info(
        "analyze request: task=%r elements=%d redacted_boxes=%s",
        req.task,
        len(req.dom_summary),
        req.redaction_meta.redacted_box_count if req.redaction_meta else "n/a",
    )

    plan = await plan_action(req.task, req.image_base64, req.dom_summary)

    latency_ms = round((time.time() - t0) * 1000, 1)
    log.info("planned action=%s in %sms", plan["action"], latency_ms)

    return AnalyzeResponse(
        action=Action(**plan["action"]),
        reasoning=plan.get("reasoning", ""),
        raw_model_output=plan.get("raw_model_output"),
    )

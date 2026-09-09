"""
vlm_client.py
----------------------------------------------------------------------
Abstraction over "whatever central LLM/VLM we point the server at".

Swap in any of:
  - An OpenAI-compatible vision endpoint (OpenAI, Azure, vLLM server,
    LM Studio, etc.) via VLM_BACKEND=openai_compatible
  - A local Ollama vision model (e.g. llava, moondream) via
    VLM_BACKEND=ollama
  - "mock" (default): a small deterministic rule-based planner that
    looks at the sanitized DOM summary only, so the whole pipeline is
    demoable without any API key / GPU server, and evaluators can see
    the contract end-to-end.

The server is explicitly "redaction-aware": prompts tell the model
that black boxes = removed sensitive fields and blurred regions =
faces/people, so it reasons correctly instead of being confused by
the sanitization artifacts.
----------------------------------------------------------------------
"""
from __future__ import annotations

import base64
import json
import os
from typing import Any, Dict, List

import httpx

from action_schema import Action, DomElement

VLM_BACKEND = os.environ.get("VLM_BACKEND", "mock")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "moondream")

SYSTEM_PROMPT = """You are a browser automation planner.
You receive:
 - A screenshot of the current page with sensitive regions already
   REMOVED: solid black boxes mean a sensitive form field or text
   (password, card number, etc.) was redacted; blurred regions mean a
   human face/photo was redacted. Do not try to read inside them.
 - A JSON list of clickable/typeable DOM elements with their ids and
   approximate text (sensitive ones show "[REDACTED]").
 - A natural-language task from the user.

Decide the SINGLE next best UI action to progress the task. Respond
ONLY with strict JSON matching:
{"action": {"type": "click|type|scroll|none", "agentId": <int|null>,
"value": <string|null>, "dx": <int|null>, "dy": <int|null>},
"reasoning": "<one sentence>"}
"""


async def plan_action(task: str, image_data_url: str, dom_summary: List[DomElement]) -> Dict[str, Any]:
    if VLM_BACKEND == "openai_compatible" and OPENAI_API_KEY:
        return await _plan_with_openai_compatible(task, image_data_url, dom_summary)
    if VLM_BACKEND == "ollama":
        return await _plan_with_ollama(task, image_data_url, dom_summary)
    return _plan_with_mock(task, dom_summary)


async def _plan_with_openai_compatible(task, image_data_url, dom_summary):
    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"Task: {task}\nDOM: {json.dumps([d.model_dump() for d in dom_summary])}"},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 400,
    }
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{OPENAI_BASE_URL}/chat/completions", json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    text = data["choices"][0]["message"]["content"]
    return _safe_parse_plan(text, raw=data)


async def _plan_with_ollama(task, image_data_url, dom_summary):
    # Ollama's /api/generate wants raw base64 (no data: prefix) for images.
    b64 = image_data_url.split(",", 1)[-1]
    prompt = f"{SYSTEM_PROMPT}\n\nTask: {task}\nDOM: {json.dumps([d.model_dump() for d in dom_summary])}"
    payload = {"model": OLLAMA_MODEL, "prompt": prompt, "images": [b64], "stream": False}
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload)
        resp.raise_for_status()
        data = resp.json()
    return _safe_parse_plan(data.get("response", ""), raw=data)


def _safe_parse_plan(text: str, raw: Any) -> Dict[str, Any]:
    try:
        start, end = text.index("{"), text.rindex("}") + 1
        parsed = json.loads(text[start:end])
        parsed.setdefault("reasoning", "")
        Action(**parsed["action"])  # validate shape
        parsed["raw_model_output"] = raw
        return parsed
    except Exception as e:  # noqa: BLE001 - fall back gracefully for the demo
        return {
            "action": {"type": "none"},
            "reasoning": f"Could not parse model output ({e}); no action taken.",
            "raw_model_output": raw,
        }


def _plan_with_mock(task: str, dom_summary: List[DomElement]) -> Dict[str, Any]:
    """
    Deterministic, offline fallback so the whole pipeline (client
    redaction -> server -> executed action) is demoable without any
    external API key or GPU. Picks the DOM element whose visible text
    best matches keywords in the task.
    """
    task_lower = task.lower()
    keywords = [w for w in task_lower.replace("'", "").split() if len(w) > 2]

    best, best_score = None, 0
    for el in dom_summary:
        if el.sensitive:
            continue
        haystack = f"{el.text} {el.placeholder or ''} {el.type or ''} {el.role or ''}".lower()
        score = sum(1 for kw in keywords if kw in haystack)
        if score > best_score:
            best, best_score = el, score

    if best and best.tag in ("input", "textarea") and "type" in task_lower or (best and best.tag in ("input", "textarea") and best.type in ("text", "search", "email")):
        return {
            "action": {"type": "click", "agentId": best.id},
            "reasoning": f"Best keyword match was input#{best.id} ('{best.text}'); focusing it first.",
        }
    if best:
        return {
            "action": {"type": "click", "agentId": best.id},
            "reasoning": f"Matched task keywords to element #{best.id} ('{best.text}').",
        }
    return {
        "action": {"type": "scroll", "dy": 400},
        "reasoning": "No confident DOM match found; scrolling to reveal more content.",
    }

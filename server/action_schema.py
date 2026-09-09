"""
Pydantic models shared by the FastAPI server.

The server NEVER receives raw PII: `image_base64` is already redacted
client-side (black boxes / blur), and `dom_summary` has sensitive text
replaced with "[REDACTED]" before it ever reaches this process. These
schemas exist partly as documentation of that contract.
"""
from __future__ import annotations

from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field


class DomElement(BaseModel):
    id: int
    tag: str
    role: Optional[str] = None
    type: Optional[str] = None
    placeholder: Optional[str] = None
    text: str
    box: dict
    sensitive: bool = False


class RedactionMeta(BaseModel):
    redacted_box_count: int = 0
    model: Optional[str] = None


class AnalyzeRequest(BaseModel):
    task: str = Field(..., description="Natural-language instruction from the user")
    image_base64: str = Field(..., description="Data URL of the SANITIZED screenshot (webp/png)")
    dom_summary: List[DomElement] = Field(default_factory=list)
    redaction_meta: Optional[RedactionMeta] = None


class Action(BaseModel):
    type: Literal["click", "type", "scroll", "none"] = "none"
    agentId: Optional[int] = None
    selector: Optional[str] = None
    value: Optional[str] = None
    dx: Optional[int] = None
    dy: Optional[int] = None


class AnalyzeResponse(BaseModel):
    action: Action
    reasoning: str = ""
    raw_model_output: Optional[Any] = None

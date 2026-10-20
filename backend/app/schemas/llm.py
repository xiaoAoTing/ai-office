from typing import Literal

from pydantic import BaseModel


class LlmStatus(BaseModel):
    worker: Literal["fake", "llm", "qoder"]
    ok: bool
    model: str | None
    ollama: bool | None = None
    version: str | None = None
    available: bool | None = None
    loaded: bool | None = None
    message: str | None = None
    """In English; the interface shows `code` with `params` in its language."""
    code: Literal["fake_worker", "qoder_worker", "ollama_down", "model_missing"] | None = None
    params: dict[str, str] = {}

from datetime import datetime
from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import AgentStatus, AgentTool, Provider
from app.schemas.common import NonEmptyStr, ORMModel, PatchModel


class AgentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    floor_id: int
    name: NonEmptyStr = Field(max_length=100)
    role_key: NonEmptyStr = Field(max_length=64)
    title: NonEmptyStr = Field(max_length=200)
    system_prompt: str = ""
    provider: Provider = Provider.OLLAMA
    model: str | None = Field(default=None, max_length=200)
    web_access: bool = False
    tools: list[AgentTool] = []
    desk_index: int | None = Field(default=None, ge=0)

    @field_validator("tools")
    @classmethod
    def unique_tools(cls, v: list[AgentTool]) -> list[AgentTool]:
        return list(dict.fromkeys(v))


class AgentUpdate(PatchModel):
    nullable_fields: ClassVar[frozenset[str]] = frozenset({"model"})

    floor_id: int | None = None
    name: NonEmptyStr | None = Field(default=None, max_length=100)
    role_key: NonEmptyStr | None = Field(default=None, max_length=64)
    title: NonEmptyStr | None = Field(default=None, max_length=200)
    system_prompt: str | None = None
    provider: Provider | None = None
    model: str | None = Field(default=None, max_length=200)
    web_access: bool | None = None
    tools: list[AgentTool] | None = None
    desk_index: int | None = Field(default=None, ge=0)

    @field_validator("tools")
    @classmethod
    def unique_tools(cls, v: list[AgentTool] | None) -> list[AgentTool] | None:
        return list(dict.fromkeys(v)) if v is not None else v


class AgentRead(ORMModel):
    id: int
    floor_id: int | None
    name: str
    role_key: str
    title: str
    system_prompt: str
    provider: Provider
    model: str | None
    web_access: bool
    tools: list[str]
    desk_index: int | None
    status: AgentStatus
    live: dict[str, str] | None = None
    """Heartbeat from an outside process: {"kind", "detail", "at"}; None when nothing drives this agent."""
    archived_at: datetime | None


class LiveUpdate(BaseModel):
    """One heartbeat from an outside process working through this agent (the Qoder CLI's hooks send these)."""

    model_config = ConfigDict(extra="forbid")

    kind: NonEmptyStr = Field(max_length=32)
    """What it is doing, e.g. `searching`, `editing`, `running`, `idle`."""
    detail: str = Field(default="", max_length=200)
    """Short free text shown above the agent, e.g. "WebSearch · qoder hooks"."""


ReleaseBlocker = Literal["tasks", "on_the_way", "away"]


class ReleaseAllResult(BaseModel):
    released: list[int]
    """Agents sent home."""
    kept: dict[int, ReleaseBlocker]
    """Agents who stay, and why: tasks in progress / queued / changes requested, on the way in, not in the office."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import ActivityKind, AgentStatus, Provider, TripKind
from app.models.types import str_enum

if TYPE_CHECKING:
    from app.models.floor import Floor
    from app.models.task import Task


TRIP_OF = {AgentStatus.ARRIVING: TripKind.ARRIVE, AgentStatus.LEAVING: TripKind.DEPART, AgentStatus.RETURNING: TripKind.RETURN}

ACTIVITY_LOG_SIZE = 12
"""Latest activities kept per agent: enough for the scene to replay where the agent has been lately."""

LIVE_IDLE = "idle"
"""The heartbeat kind an outside process sends when it has stopped working: the agent may sit down at once."""


def live_active(live: dict[str, str] | None, at: datetime, ttl_seconds: float) -> bool:
    """A heartbeat means work until `at` + ttl, unless it says the outside process stopped."""
    sent = _parse_time((live or {}).get("at"))
    if not live or live.get("kind") == LIVE_IDLE or sent is None:
        return False
    return (at - sent).total_seconds() <= ttl_seconds


def live_left(live: dict[str, str] | None, at: datetime, ttl_seconds: float) -> float:
    """Seconds until the heartbeat goes stale; 0 when there is nothing to wait for."""
    sent = _parse_time((live or {}).get("at"))
    if sent is None:
        return 0.0
    return max(ttl_seconds - (at - sent).total_seconds(), 0.0)


def _parse_time(value: object) -> datetime | None:
    """Heartbeat times are stored ISO-8601 with an offset; anything unreadable counts as no heartbeat."""
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = (
        UniqueConstraint("floor_id", "desk_index", name="uq_agents_floor_desk"),
        CheckConstraint("desk_index >= 0", name="desk_index_non_negative"),
        CheckConstraint("(trip_kind IS NULL) = (trip_started_at IS NULL)", name="trip_complete"),
        CheckConstraint(
            "(archived_at IS NULL AND floor_id IS NOT NULL AND desk_index IS NOT NULL)"
            " OR (archived_at IS NOT NULL AND floor_id IS NULL AND desk_index IS NULL)",
            name="placement_matches_archive",
        ),
        Index(
            "uq_agents_role_key_active",
            "role_key",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    floor_id: Mapped[int | None] = mapped_column(
        ForeignKey("floors.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    role_key: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(200))
    system_prompt: Mapped[str] = mapped_column(Text, default="", server_default="")
    provider: Mapped[Provider] = mapped_column(
        str_enum(Provider, "provider"), default=Provider.OLLAMA, server_default=Provider.OLLAMA
    )
    model: Mapped[str | None] = mapped_column(String(200))
    web_access: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    tools: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    """Tool sets besides the web (`AgentTool` values)."""
    desk_index: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[AgentStatus] = mapped_column(
        str_enum(AgentStatus, "agent_status"),
        default=AgentStatus.OFF_SITE,
        server_default=AgentStatus.OFF_SITE,
    )
    status_since: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    trip_kind: Mapped[TripKind | None] = mapped_column(str_enum(TripKind, "trip_kind"))
    trip_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    """The latest trip (arriving, leaving or returning); kept after it ends so the scene can plan around it."""
    trip_origin_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    """Start of the departure the latest trip continues: a return (turned back on the way) or an arrival
    that came straight back from the map edge. None for an ordinary trip."""
    leave_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    """«Release all» lets people go one after another: this agent leaves at this time (the executor does it)."""
    activity_log: Mapped[list[dict[str, str]]] = mapped_column(JSONB, default=list, server_default="[]")
    """Latest activities, oldest first: [{"kind": ActivityKind, "since": ISO time}], at most ACTIVITY_LOG_SIZE."""
    live: Mapped[dict[str, str] | None] = mapped_column(JSONB)
    """A heartbeat from outside: {"kind", "detail", "at"} set by `POST /agents/{id}/live` while another process
    (the Qoder CLI) works through this agent. The executor turns fresh heartbeats into work; None when cleared."""
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def set_status(self, status: AgentStatus, at: datetime, origin: datetime | None = None) -> None:
        """Every status change goes through here: it stamps the start of the status and of a trip.
        `origin`: the start of the departure this trip continues (see `trip_origin_at`)."""
        self.status = status
        self.status_since = at
        if status not in (AgentStatus.IDLE, AgentStatus.WAITING_REVIEW):
            # Leaving, or back at work: a planned «go home» no longer applies.
            self.leave_at = None
        trip = TRIP_OF.get(status)
        if trip is not None:
            self.trip_kind = trip
            self.trip_started_at = at
            self.trip_origin_at = origin
        self.set_activity(ActivityKind(status.value), at)

    def set_activity(self, kind: ActivityKind, at: datetime) -> None:
        """Appends to the activity log unless the agent is already doing that (a new list, so the JSONB is saved)."""
        log = list(self.activity_log or [])
        if log and log[-1].get("kind") == kind:
            return
        self.activity_log = [*log, {"kind": kind.value, "since": at.isoformat()}][-ACTIVITY_LOG_SIZE:]

    floor: Mapped["Floor | None"] = relationship(back_populates="agents")
    tasks: Mapped[list["Task"]] = relationship(back_populates="agent")

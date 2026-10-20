from datetime import datetime

from pydantic import BaseModel

from app.models.enums import ActivityKind, AgentStatus, FloorKind, RunStatus, TaskStage, TaskStatus, TripKind
from app.schemas.agent import ReleaseBlocker


class WebStep(BaseModel):
    """The step running right now: a web search (target = query), a page read (target = site), a job search
    (`jobs`, target = query · place) or a job advert read (`job`, target = job)."""

    kind: str
    target: str


class CurrentTask(BaseModel):
    id: int
    title: str
    status: TaskStatus
    stage: TaskStage | None
    waiting_for_model: bool = False
    on_web: bool = False
    """A web search or page read is in progress in the running stage."""
    run_state: RunStatus | None = None
    """`waiting` (queued for the model) or `running`; None between stages."""
    web_step: WebStep | None = None


class Trip(BaseModel):
    """An agent's latest trip; it lasts `Motion.arrive_seconds` or `Motion.depart_seconds` from `started_at`;
    a return lasts (`started_at` − `origin_at`) + `Motion.return_extra_seconds`."""

    kind: TripKind
    started_at: datetime
    origin_at: datetime | None = None
    """Start of the departure this trip continues: the one a return turned back from, or the one an arrival
    came straight back from (the car drove to the map edge and returned)."""


class Activity(BaseModel):
    kind: ActivityKind
    since: datetime


class Live(BaseModel):
    """A heartbeat from an outside process; `detail` is what the scene shows above the agent."""

    kind: str
    detail: str = ""
    at: datetime


class AgentState(BaseModel):
    id: int
    name: str
    role_key: str
    title: str
    desk_index: int
    status: AgentStatus
    status_since: datetime
    trip: Trip | None = None
    activity_log: list[Activity] = []
    """Latest activities, oldest first (the scene replays where the agent has been lately)."""
    live: Live | None = None
    """Heartbeat from an outside process driving this agent; None when nothing does."""
    web_access: bool
    tools: list[str] = []
    current_task: CurrentTask | None
    queue_length: int
    awaiting_review: int
    release_blocked: ReleaseBlocker | None = None
    """Why the director cannot send the agent home now; None when they can."""
    leave_at: datetime | None = None
    """Let go with «Release all», leaves at this time (people go one after another)."""


class FloorState(BaseModel):
    id: int
    number: int
    name: str
    kind: FloorKind
    capacity: int
    has_director_office: bool
    has_server_room: bool
    has_kitchen: bool
    agents: list[AgentState]


class WorldStats(BaseModel):
    tasks_in_progress: int
    awaiting_review: int
    done_today: int
    model_busy: bool = False
    """A model request is running right now (real model only, not the fake worker)."""
    model_queue: int = 0
    """Stage runs waiting for the model."""


class Motion(BaseModel):
    """What the scene needs to animate trips: their lengths and the server clock."""

    arrive_seconds: float
    depart_seconds: float
    turn_back_seconds: float
    """A departing car stays in its spot at least this long; a return can only start before it."""
    return_extra_seconds: float
    server_time: datetime


class WorldState(BaseModel):
    floors: list[FloorState]
    stats: WorldStats
    motion: Motion

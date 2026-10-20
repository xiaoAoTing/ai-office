from enum import StrEnum


class FloorKind(StrEnum):
    RECEPTION = "reception"
    OFFICE = "office"


class Provider(StrEnum):
    OLLAMA = "ollama"
    ANTHROPIC = "anthropic"


class RunProvider(StrEnum):
    """Who produced a run; `fake` marks the stand-in executor so its tokens never mix with real ones."""

    OLLAMA = "ollama"
    ANTHROPIC = "anthropic"
    QODER = "qoder"
    FAKE = "fake"


class AgentTool(StrEnum):
    """Tool sets an agent may use besides the web (`web_access`); set per agent, never by role in code."""

    JOBS = "jobs"
    """search_jobs and get_job: vacancies from the Adzuna and Reed APIs."""


class AgentStatus(StrEnum):
    OFF_SITE = "off_site"
    ARRIVING = "arriving"
    IDLE = "idle"
    WORKING = "working"
    WAITING_REVIEW = "waiting_review"
    LEAVING = "leaving"
    """Going home: only when the director releases the agent."""
    RETURNING = "returning"
    """Turned back on the way home (a task came before the car left its spot), walking back to the desk."""


class ActivityKind(StrEnum):
    """What an agent is doing, for the scene: the status, with work split into working / waiting for the model."""

    OFF_SITE = "off_site"
    ARRIVING = "arriving"
    WORKING = "working"
    WAITING_MODEL = "waiting_model"
    WAITING_REVIEW = "waiting_review"
    IDLE = "idle"
    LEAVING = "leaving"
    RETURNING = "returning"


class TripKind(StrEnum):
    """An agent's trip between the map edge and their desk, or back to the desk from a departure."""

    ARRIVE = "arrive"
    DEPART = "depart"
    RETURN = "return"


class TaskStatus(StrEnum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    PAUSED = "paused"
    NEEDS_REVIEW = "needs_review"
    CHANGES_REQUESTED = "changes_requested"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskStage(StrEnum):
    PLAN = "plan"
    RESEARCH = "research"
    DRAFT = "draft"
    SELF_CHECK = "self_check"


class CommentAuthor(StrEnum):
    DIRECTOR = "director"
    AGENT = "agent"


class RunStatus(StrEnum):
    WAITING = "waiting"
    """Queued for the model (GPU); the request has not been sent yet."""
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    INTERRUPTED = "interrupted"
    CANCELLED = "cancelled"

from collections import defaultdict
from urllib.parse import urlsplit
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, Floor, Run, Task
from app.models.enums import RunProvider, RunStatus, TaskStatus
from app.core.config import Settings, get_settings
from app.schemas.state import Activity, AgentState, CurrentTask, FloorState, Live, Motion, Trip, WebStep, WorldState, WorldStats
from app.services import rules


def start_of_local_day(now: datetime) -> datetime:
    return now.astimezone().replace(hour=0, minute=0, second=0, microsecond=0)


def web_step(run: Run | None) -> WebStep | None:
    """The running web step of a run: a search shows its query, a page read its site (host without `www.`)."""
    if run is None or run.status != RunStatus.RUNNING or not run.activity:
        return None
    step = run.activity[-1]
    if step.get("status") != "running":
        return None
    kind = str(step.get("kind", ""))
    target = str(step.get("target", ""))
    if kind == "fetch":
        host = urlsplit(str(step.get("url") or target)).hostname or target
        target = host.removeprefix("www.")
    elif kind == "job":
        target = target.split(" ", 1)[-1]
    return WebStep(kind=kind, target=target)


async def build_state(session: AsyncSession, now: datetime | None = None, settings: Settings | None = None) -> WorldState:
    settings = settings or get_settings()
    now = now or datetime.now(UTC)
    floors = (await session.scalars(select(Floor).order_by(Floor.number))).all()
    agents = (
        await session.scalars(
            select(Agent).where(Agent.archived_at.is_(None)).order_by(Agent.desk_index)
        )
    ).all()
    tasks = (
        await session.scalars(
            select(Task).where(
                Task.agent_id.in_([a.id for a in agents]),
                Task.status.in_(rules.ACTIVE_STATUSES),
            )
        )
    ).all()

    live_runs = (
        await session.scalars(
            select(Run).where(Run.status.in_([RunStatus.WAITING, RunStatus.RUNNING]), Run.task_id.in_([t.id for t in tasks]))
        )
    ).all()
    waiting = {r.task_id for r in live_runs if r.status == RunStatus.WAITING}
    on_web = {r.task_id for r in live_runs if r.status == RunStatus.RUNNING and r.activity and r.activity[-1].get("status") == "running"}
    run_of = {r.task_id: r for r in live_runs}
    model_busy = any(r.status == RunStatus.RUNNING and r.provider == RunProvider.OLLAMA for r in live_runs)

    tasks_by_agent: dict[int, list[Task]] = defaultdict(list)
    for task in tasks:
        tasks_by_agent[task.agent_id].append(task)

    agents_by_floor: dict[int, list[AgentState]] = defaultdict(list)
    for agent in agents:
        assert agent.floor_id is not None and agent.desk_index is not None
        own = tasks_by_agent[agent.id]
        current = rules.pick_current_task(own)
        agents_by_floor[agent.floor_id].append(
            AgentState(
                id=agent.id,
                name=agent.name,
                role_key=agent.role_key,
                title=agent.title,
                desk_index=agent.desk_index,
                status=agent.status,
                status_since=agent.status_since,
                activity_log=[Activity.model_validate(entry) for entry in agent.activity_log or []],
                live=Live.model_validate(agent.live) if agent.live else None,
                trip=(
                    Trip(kind=agent.trip_kind, started_at=agent.trip_started_at, origin_at=agent.trip_origin_at)
                    if agent.trip_kind is not None and agent.trip_started_at is not None
                    else None
                ),
                web_access=agent.web_access,
                tools=list(agent.tools or []),
                current_task=(
                    CurrentTask(
                        id=current.id,
                        title=current.title,
                        status=current.status,
                        stage=current.stage,
                        waiting_for_model=current.id in waiting,
                        on_web=current.id in on_web,
                        run_state=run_of[current.id].status if current.id in run_of else None,
                        web_step=web_step(run_of.get(current.id)),
                    )
                    if current
                    else None
                ),
                queue_length=sum(t.status == TaskStatus.QUEUED for t in own),
                awaiting_review=sum(t.status == TaskStatus.NEEDS_REVIEW for t in own),
                release_blocked=rules.release_blocker(agent.status, (t.status for t in own)),
                leave_at=agent.leave_at,
            )
        )

    done_today = await session.scalar(
        select(func.count())
        .select_from(Task)
        .where(
            Task.status == TaskStatus.DONE,
            Task.finished_at >= start_of_local_day(now),
        )
    )

    return WorldState(
        floors=[
            FloorState(
                id=f.id,
                number=f.number,
                name=f.name,
                kind=f.kind,
                capacity=f.capacity,
                has_director_office=f.has_director_office,
                has_server_room=f.has_server_room,
                has_kitchen=f.has_kitchen,
                agents=agents_by_floor[f.id],
            )
            for f in floors
        ],
        stats=WorldStats(
            tasks_in_progress=sum(t.status == TaskStatus.IN_PROGRESS for t in tasks),
            awaiting_review=sum(t.status == TaskStatus.NEEDS_REVIEW for t in tasks),
            done_today=done_today or 0,
            model_busy=model_busy,
            model_queue=len(waiting),
        ),
        motion=Motion(
            arrive_seconds=settings.executor_arrive_seconds,
            depart_seconds=settings.executor_depart_seconds,
            turn_back_seconds=settings.executor_turn_back_seconds,
            return_extra_seconds=settings.executor_return_extra_seconds,
            server_time=now,
        ),
    )

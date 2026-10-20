from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.events import publish_agent
from app.models import Agent, Task
from app.models.enums import AgentStatus, TaskStatus
from app.schemas.agent import AgentCreate, AgentUpdate, LiveUpdate
from app.services import rules
from app.services.errors import ConflictError, NotFoundError
from app.services.floors import count_active_agents, get_floor


async def list_agents(
    session: AsyncSession, *, floor_id: int | None = None, include_archived: bool = False
) -> Sequence[Agent]:
    stmt = select(Agent).order_by(Agent.id)
    if floor_id is not None:
        stmt = stmt.where(Agent.floor_id == floor_id)
    if not include_archived:
        stmt = stmt.where(Agent.archived_at.is_(None))
    result = await session.scalars(stmt)
    return result.all()


async def get_agent(session: AsyncSession, agent_id: int, *, lock: bool = False) -> Agent:
    stmt = select(Agent).where(Agent.id == agent_id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    agent = await session.scalar(stmt)
    if agent is None:
        raise NotFoundError(f"Agent {agent_id} not found")
    return agent


def ensure_active(agent: Agent) -> None:
    if agent.archived_at is not None:
        raise ConflictError(f"Agent {agent.id} is archived")


async def _taken_desks(
    session: AsyncSession, floor_id: int, exclude_agent_id: int | None = None
) -> set[int]:
    stmt = select(Agent.desk_index).where(Agent.floor_id == floor_id)
    if exclude_agent_id is not None:
        stmt = stmt.where(Agent.id != exclude_agent_id)
    result = await session.scalars(stmt)
    return {d for d in result.all() if d is not None}


async def _ensure_role_key_free(
    session: AsyncSession, role_key: str, exclude_agent_id: int | None = None
) -> None:
    stmt = select(Agent.id).where(Agent.role_key == role_key, Agent.archived_at.is_(None))
    if exclude_agent_id is not None:
        stmt = stmt.where(Agent.id != exclude_agent_id)
    if await session.scalar(stmt) is not None:
        raise ConflictError(f"Role key '{role_key}' is already used by an active agent")


async def _place(
    session: AsyncSession,
    floor_id: int,
    desk_index: int | None,
    *,
    agent_id: int | None = None,
    joining: bool,
) -> int:
    floor = await get_floor(session, floor_id, lock=True)
    rules.ensure_floor_accepts_agents(floor.kind)
    if joining:
        rules.ensure_floor_has_room(await count_active_agents(session, floor.id), floor.capacity)
    taken = await _taken_desks(session, floor.id, exclude_agent_id=agent_id)
    if desk_index is None:
        return rules.first_free_desk(taken, floor.capacity)
    rules.ensure_desk_in_range(desk_index, floor.capacity)
    if desk_index in taken:
        raise ConflictError(f"Desk {desk_index} on floor {floor.number} is taken")
    return desk_index


async def create_agent(session: AsyncSession, data: AgentCreate) -> Agent:
    await _ensure_role_key_free(session, data.role_key)
    desk = await _place(session, data.floor_id, data.desk_index, joining=True)
    agent = Agent(**data.model_dump(exclude={"desk_index"}), desk_index=desk)
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return agent


async def update_agent(session: AsyncSession, agent_id: int, data: AgentUpdate) -> Agent:
    agent = await get_agent(session, agent_id, lock=True)
    ensure_active(agent)
    changes = data.changes()

    if "role_key" in changes and changes["role_key"] != agent.role_key:
        await _ensure_role_key_free(session, changes["role_key"], exclude_agent_id=agent.id)

    target_floor = changes.pop("floor_id", agent.floor_id)
    moving = target_floor != agent.floor_id
    if moving or "desk_index" in changes:
        assert target_floor is not None
        desk = changes.pop("desk_index", None if moving else agent.desk_index)
        agent.desk_index = await _place(
            session, target_floor, desk, agent_id=agent.id, joining=moving
        )
        agent.floor_id = target_floor

    for field, value in changes.items():
        setattr(agent, field, value)
    await session.commit()
    await session.refresh(agent)
    return agent


async def _active_task_statuses(session: AsyncSession, agent_id: int) -> list[TaskStatus]:
    stmt = select(Task.status).where(Task.agent_id == agent_id, Task.status.in_(rules.ACTIVE_STATUSES))
    return list((await session.scalars(stmt)).all())


async def set_live(session: AsyncSession, agent_id: int, data: LiveUpdate) -> Agent:
    """One heartbeat from an outside process working through this agent (the Qoder CLI's hooks).

    This only records what the outside is doing; the executor decides where the agent is and stamp the status, so
    a heartbeat never fights a task or the director's own command.
    """
    agent = await get_agent(session, agent_id, lock=True)
    ensure_active(agent)
    agent.live = {"kind": data.kind, "detail": data.detail.strip(), "at": datetime.now(UTC).isoformat()}
    await session.commit()
    await session.refresh(agent)
    publish_agent(agent.id, agent.status)
    return agent


async def release_agent(session: AsyncSession, agent_id: int) -> Agent:
    """Sends an agent home (the director's command): only from the office and with nothing to work on."""
    agent = await get_agent(session, agent_id, lock=True)
    ensure_active(agent)
    rules.ensure_releasable(agent.status, await _active_task_statuses(session, agent.id))
    agent.set_status(AgentStatus.LEAVING, datetime.now(UTC))
    await session.commit()
    await session.refresh(agent)
    publish_agent(agent.id, agent.status)
    return agent


async def release_all(session: AsyncSession, gap: float) -> tuple[list[int], dict[int, str]]:
    """Sends home everyone who can go, one after another `gap` seconds apart (the first at once, the rest
    through `leave_at`, which the executor carries out); returns (released ids, the others → why they stay)."""
    agents = (
        await session.scalars(
            select(Agent)
            .where(Agent.archived_at.is_(None))
            .order_by(Agent.floor_id, Agent.desk_index, Agent.id)
            .with_for_update()
        )
    ).all()
    at = datetime.now(UTC)
    released: list[Agent] = []
    kept: dict[int, str] = {}
    for agent in agents:
        reason = rules.release_blocker(agent.status, await _active_task_statuses(session, agent.id))
        if reason is not None:
            kept[agent.id] = reason
            continue
        if released:
            agent.leave_at = at + timedelta(seconds=gap * len(released))
        else:
            agent.set_status(AgentStatus.LEAVING, at)
        released.append(agent)
    await session.commit()
    for agent in released:
        publish_agent(agent.id, agent.status)
    return [a.id for a in released], kept


async def archive_agent(session: AsyncSession, agent_id: int) -> Agent:
    agent = await get_agent(session, agent_id, lock=True)
    ensure_active(agent)
    active_tasks = await session.scalar(
        select(func.count())
        .select_from(Task)
        .where(Task.agent_id == agent.id, Task.status.in_(rules.ACTIVE_STATUSES))
    )
    rules.ensure_no_active_tasks(active_tasks or 0)
    agent.archived_at = datetime.now(UTC)
    agent.floor_id = None
    agent.desk_index = None
    agent.set_status(AgentStatus.OFF_SITE, agent.archived_at)
    await session.commit()
    await session.refresh(agent)
    publish_agent(agent.id, agent.status)
    return agent

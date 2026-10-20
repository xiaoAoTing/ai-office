from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.schemas.agent import AgentCreate, AgentRead, AgentUpdate, LiveUpdate, ReleaseAllResult
from app.services import agents as service

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentRead], status_code=status.HTTP_200_OK)
async def list_agents(
    floor_id: int | None = None,
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
) -> list[AgentRead]:
    agents = await service.list_agents(db, floor_id=floor_id, include_archived=include_archived)
    return [AgentRead.model_validate(a) for a in agents]


@router.post("", response_model=AgentRead, status_code=status.HTTP_201_CREATED)
async def create_agent(data: AgentCreate, db: AsyncSession = Depends(get_db)) -> AgentRead:
    return AgentRead.model_validate(await service.create_agent(db, data))


@router.post("/release-all", response_model=ReleaseAllResult, status_code=status.HTTP_200_OK)
async def release_all(db: AsyncSession = Depends(get_db)) -> ReleaseAllResult:
    """Sends home every agent who can go (in the office, no tasks in progress, queued or with changes requested),
    one after another `EXECUTOR_RELEASE_GAP_SECONDS` apart."""
    released, kept = await service.release_all(db, get_settings().executor_release_gap_seconds)
    return ReleaseAllResult.model_validate({"released": released, "kept": kept})


@router.post("/{agent_id}/live", response_model=AgentRead, status_code=status.HTTP_200_OK)
async def set_agent_live(agent_id: int, data: LiveUpdate, db: AsyncSession = Depends(get_db)) -> AgentRead:
    """One heartbeat from an outside process working through this agent; the executor moves the agent from it."""
    return AgentRead.model_validate(await service.set_live(db, agent_id, data))


@router.post("/{agent_id}/release", response_model=AgentRead, status_code=status.HTTP_200_OK)
async def release_agent(agent_id: int, db: AsyncSession = Depends(get_db)) -> AgentRead:
    """Sends the agent home; 409 when they have tasks in progress, queued or with changes requested, or are not in the office."""
    return AgentRead.model_validate(await service.release_agent(db, agent_id))


@router.get("/{agent_id}", response_model=AgentRead, status_code=status.HTTP_200_OK)
async def read_agent(agent_id: int, db: AsyncSession = Depends(get_db)) -> AgentRead:
    return AgentRead.model_validate(await service.get_agent(db, agent_id))


@router.patch("/{agent_id}", response_model=AgentRead, status_code=status.HTTP_200_OK)
async def update_agent(
    agent_id: int, data: AgentUpdate, db: AsyncSession = Depends(get_db)
) -> AgentRead:
    return AgentRead.model_validate(await service.update_agent(db, agent_id, data))


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_agent(agent_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    await service.archive_agent(db, agent_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

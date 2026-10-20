"""A heartbeat from an outside process: what counts as work, and what the API records and shows."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient

from app.models.agent import live_active, live_left
from tests.conftest import Factory

TTL = 180.0


def test_a_fresh_heartbeat_means_work() -> None:
    at = datetime.now(UTC)
    live = {"kind": "editing", "detail": "Edit · runner.py", "at": at.isoformat()}
    assert live_active(live, at + timedelta(seconds=10), TTL)
    assert live_left(live, at, TTL) == pytest.approx(TTL)
    # one second past the limit and the agent is free again
    assert not live_active(live, at + timedelta(seconds=TTL + 1), TTL)


def test_idle_missing_and_unreadable_heartbeats_are_not_work() -> None:
    at = datetime.now(UTC)
    assert not live_active(None, at, TTL)
    assert not live_active({"kind": "idle", "detail": "session ended", "at": at.isoformat()}, at, TTL)
    assert not live_active({"kind": "editing", "detail": "", "at": "not a time"}, at, TTL)
    assert live_left({"kind": "editing", "at": "not a time"}, at, TTL) == 0


async def test_a_heartbeat_is_recorded_and_reaches_the_scene(
    client: AsyncClient, make_floor: Factory, make_agent: Factory
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    body: dict[str, Any] = {"kind": "searching", "detail": "WebSearch · qoder hooks"}
    response = await client.post(f"/api/v1/agents/{agent['id']}/live", json=body)
    assert response.status_code == 200
    stored = response.json()["live"]
    assert stored["kind"] == "searching" and stored["detail"] == body["detail"]

    # the scene reads one snapshot: the heartbeat must be in it, or the label above the agent cannot follow it
    state = (await client.get("/api/v1/state")).json()
    shown = [a for floor_state in state["floors"] for a in floor_state["agents"] if a["id"] == agent["id"]][0]
    assert shown["live"]["detail"] == body["detail"]


async def test_the_detail_of_a_heartbeat_is_bounded(client: AsyncClient, make_floor: Factory, make_agent: Factory) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    assert (await client.post(f"/api/v1/agents/{agent['id']}/live", json={"kind": "running", "detail": "x" * 201})).status_code == 422
    assert (await client.post(f"/api/v1/agents/{agent['id']}/live", json={"kind": "running", "extra": 1})).status_code == 422


async def test_a_heartbeat_for_an_agent_that_is_not_here_is_404(client: AsyncClient) -> None:
    assert (await client.post("/api/v1/agents/424242/live", json={"kind": "idle"})).status_code == 404

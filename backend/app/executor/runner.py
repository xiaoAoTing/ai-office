"""Background executor: moves agents through their day and tasks through their stages.

One supervisor loop keeps one asyncio worker per agent that has something to do, so agents work in parallel
and each one handles a single task at a time. All state lives in the database: every step is a short
transaction that re-checks the current status under `SELECT ... FOR UPDATE`, so the director's actions
(pause, cancel, request changes) always win, and a restart simply resumes from what the rows say.
A Postgres advisory lock makes sure only one executor runs against a database.
"""

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import DBAPIError, InterfaceError, OperationalError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession, async_sessionmaker

from app.events import Event, EventBus, publish_agent, publish_artifact, publish_progress, publish_run, publish_task
from app.events import bus as default_bus
from app.executor.worker import (
    ActivityStep,
    AgentSnapshot,
    CommentSnapshot,
    ProfileSnapshot,
    StageError,
    StageInput,
    StageOutput,
    StageWorker,
    TaskSnapshot,
)
from app.models import Agent, Artifact, Profile, Run, Task, TaskComment
from app.models.agent import live_active, live_left
from app.models.enums import ActivityKind, AgentStatus, RunStatus, TaskStage, TaskStatus
from app.models.profile import PROFILE_ID
from app.services import rules
from app.services.tasks import apply_transition

log = logging.getLogger(__name__)

LOCK_KEY = 0x4149_4F46
"""pg advisory lock id ("AIOF"): one executor per database."""

WORKABLE = frozenset(rules.EXECUTOR_PICK_ORDER)


@dataclass(frozen=True)
class Timings:
    arrive: float
    depart: float
    tick: float
    """Fallback re-check interval; events usually wake things up sooner."""
    progress: float = 1.0
    """How often text produced so far is saved to the run while a stage runs."""
    turn_back: float = 50.0
    """A task that comes this long into a departure or sooner turns the agent back (the car has not moved yet)."""
    return_extra: float = 12.0
    """A return lasts the time already spent leaving plus this."""
    db_retry: float = 5.0
    """While the database cannot be reached, the executor tries again this often."""
    live: float = 180.0
    """How long a heartbeat from an outside process (`POST /agents/{id}/live`) counts as work."""

    def return_seconds(self, origin: datetime, started: datetime) -> float:
        """Length of a return trip; the scene computes the same (`trips.ts` → `durationOf`)."""
        return (started - origin).total_seconds() + self.return_extra


class _Cancelled:
    pass


class _Paused:
    """The task was paused before the model request went out: the stage stops at once and runs again on resume."""


class _RunReport:
    """The executor's side of `StageReport`: run status changes and throttled partial text, all in the DB."""

    def __init__(self, executor: "Executor", run_id: int, task_id: int, agent_id: int) -> None:
        self._ex = executor
        self.run_id, self.task_id, self.agent_id = run_id, task_id, agent_id
        self._text: str | None = None
        self._saved: str | None = None
        self._saved_at = 0.0
        self.sent = True
        """The stage is at work (not queued for the model, not waiting for Ollama): a pause waits for the stage end.
        Only a worker that reports waiting clears it, so a stage counts as working until it says otherwise."""

    async def waiting(self) -> None:
        self.sent = False
        await self._ex._set_run_status(self, RunStatus.WAITING)
        await self._ex._set_activity(self.agent_id, ActivityKind.WAITING_MODEL)

    async def started(self) -> None:
        self.sent = True
        await self._ex._set_run_status(self, RunStatus.RUNNING)
        await self._ex._set_activity(self.agent_id, ActivityKind.WORKING)

    async def unavailable(self, url: str) -> None:
        self.sent = False
        await self._ex._set_run_status(
            self,
            RunStatus.WAITING,
            error=f"Ollama is not answering at {url}; waiting for it and going on by itself.",
            error_code="model_unavailable",
            error_params={"url": url},
        )
        await self._ex._set_activity(self.agent_id, ActivityKind.WAITING_MODEL)

    def partial(self, text: str) -> None:
        self._text = text

    async def activity(self, steps: list[ActivityStep]) -> None:
        async with self._ex._sessions() as s:
            await s.execute(update(Run).where(Run.id == self.run_id).values(activity=steps))
            await s.commit()
        publish_run(self.task_id, self.agent_id, self.run_id, RunStatus.RUNNING)
        publish_progress(self.task_id, self.agent_id, self.run_id)

    async def flush(self) -> None:
        loop = asyncio.get_running_loop()
        if self._text is None or self._text == self._saved or loop.time() - self._saved_at < self._ex._t.progress:
            return
        text, self._saved, self._saved_at = self._text, self._text, loop.time()
        async with self._ex._sessions() as s:
            await s.execute(
                update(Run).where(Run.id == self.run_id, Run.status == RunStatus.RUNNING).values(output=text)
            )
            await s.commit()
        publish_progress(self.task_id, self.agent_id, self.run_id)


CANCELLED = _Cancelled()
PAUSED = _Paused()

def now() -> datetime:
    return datetime.now(UTC)


def db_unreachable(err: BaseException) -> bool:
    """The database is down, restarting or the connection dropped (not a bug in a query)."""
    if isinstance(err, OSError | InterfaceError | OperationalError):
        return True
    if isinstance(err, DBAPIError):
        sqlstate = getattr(err.orig, "sqlstate", None) or ""
        return err.connection_invalidated or isinstance(err.orig, OSError) or sqlstate.startswith(("08", "57P"))
    return False


class Executor:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        engine: AsyncEngine,
        worker: StageWorker,
        timings: Timings,
        bus: EventBus = default_bus,
    ) -> None:
        self._sessions = sessions
        self._engine = engine
        self._worker = worker
        self._t = timings
        self._bus = bus
        self._workers: dict[int, asyncio.Task[None]] = {}
        self._pokes: dict[int, asyncio.Event] = {}
        self._stop = asyncio.Event()
        self._main: asyncio.Task[None] | None = None
        self.active = False
        """True while this instance holds the lock and runs agents."""
        self._served = False

    # ---------- lifecycle ----------

    async def start(self) -> None:
        self._stop = asyncio.Event()
        self._main = asyncio.create_task(self._run(), name="executor")

    async def stop(self) -> None:
        self._stop.set()
        if self._main is not None:
            await asyncio.gather(self._main, return_exceptions=True)
            self._main = None

    async def _run(self) -> None:
        """Serves until stopped; while the database cannot be reached, tries again every `db_retry` seconds."""
        down = False
        while not self._stop.is_set():
            self._served = False
            try:
                await self._serve(recovered=down)
                return
            except Exception as err:
                if not db_unreachable(err):
                    raise
                if self._served:
                    down = False
                if not down:
                    log.warning("executor: database unreachable (%s), retrying every %s s", err or type(err).__name__, self._t.db_retry)
                down = True
            if await self._sleep(self._t.db_retry):
                return

    async def _serve(self, *, recovered: bool) -> None:
        async with self._engine.connect() as conn:
            while not await self._try_lock(conn):
                if await self._sleep(self._t.tick):
                    return
            if recovered:
                log.info("executor: database reachable again, starting")
            self.active = self._served = True
            try:
                await self._recover()
                async with self._bus.subscribe() as events:
                    while not self._stop.is_set():
                        await self._sync_workers()
                        await self._next_events(events)
            except Exception as err:
                if not db_unreachable(err):
                    log.exception("executor crashed")
                raise
            finally:
                self.active = False
                for worker in self._workers.values():
                    worker.cancel()
                await asyncio.gather(*self._workers.values(), return_exceptions=True)
                self._workers.clear()
                with contextlib.suppress(OSError, DBAPIError):
                    await conn.scalar(select(func.pg_advisory_unlock(LOCK_KEY)))
                    await conn.commit()

    @staticmethod
    async def _try_lock(conn: AsyncConnection) -> bool:
        locked = await conn.scalar(select(func.pg_try_advisory_lock(LOCK_KEY)))
        await conn.commit()
        return bool(locked)

    async def _recover(self) -> None:
        """Runs left `running` by a crash or restart are marked interrupted; their stage runs again."""
        async with self._sessions() as s:
            await s.execute(
                update(Run)
                .where(Run.status.in_([RunStatus.RUNNING, RunStatus.WAITING]))
                .values(status=RunStatus.INTERRUPTED, finished_at=now(), error="Interrupted by a server restart", error_code="interrupted")
            )
            await s.commit()

    async def _sync_workers(self) -> None:
        async with self._sessions() as s:
            busy = select(Task.agent_id).where(Task.status.in_(WORKABLE))
            ids = (
                await s.scalars(
                    select(Agent.id).where(
                        Agent.archived_at.is_(None),
                        or_(Agent.status != AgentStatus.OFF_SITE, Agent.id.in_(busy), Agent.live.is_not(None)),
                    )
                )
            ).all()
        for agent_id, worker in list(self._workers.items()):
            if worker.done():
                del self._workers[agent_id]
                if not worker.cancelled() and worker.exception() is not None:
                    log.error("agent %s worker failed", agent_id, exc_info=worker.exception())
        for agent_id in ids:
            if agent_id not in self._workers:
                self._workers[agent_id] = asyncio.create_task(self._agent_loop(agent_id), name=f"agent-{agent_id}")

    async def _next_events(self, events: asyncio.Queue[Event]) -> None:
        try:
            self._route(await asyncio.wait_for(events.get(), self._t.tick))
        except TimeoutError:
            return
        while not events.empty():
            self._route(events.get_nowait())

    def _route(self, event: Event) -> None:
        agent_id = event.data.get("id") if event.type == "agent" else event.data.get("agent_id")
        if isinstance(agent_id, int):
            self._poke(agent_id).set()

    def _poke(self, agent_id: int) -> asyncio.Event:
        return self._pokes.setdefault(agent_id, asyncio.Event())

    async def _sleep(self, seconds: float) -> bool:
        """Sleeps unless the executor stops first; True means stop."""
        try:
            await asyncio.wait_for(self._stop.wait(), max(seconds, 0))
            return True
        except TimeoutError:
            return self._stop.is_set()

    async def _wait_poke(self, agent_id: int, limit: float | None = None) -> None:
        """Until something about the agent changes (an event), a tick, or `limit` seconds, whichever is first."""
        try:
            await asyncio.wait_for(self._poke(agent_id).wait(), min(self._t.tick, limit) if limit is not None else self._t.tick)
        except TimeoutError:
            pass

    # ---------- agent lifecycle ----------

    async def _agent_loop(self, agent_id: int) -> None:
        while not self._stop.is_set():
            self._poke(agent_id).clear()
            loaded = await self._load(agent_id)
            if loaded is None:
                return
            status, since, origin, leave_at, tasks, live = loaded
            nxt = rules.pick_next_task(tasks)
            working = live_active(live, now(), self._t.live)

            if status == AgentStatus.OFF_SITE:
                if nxt is None and not working:
                    if live is not None:
                        await self._clear_live(agent_id)
                    return
                await self._set_status(agent_id, AgentStatus.ARRIVING, expected=status)
            elif status in (AgentStatus.ARRIVING, AgentStatus.RETURNING):
                length = self._t.return_seconds(origin, since) if status == AgentStatus.RETURNING and origin else self._t.arrive
                if await self._sleep(self._remaining(length, since)):
                    return
                await self._set_status(agent_id, AgentStatus.IDLE, expected=status)
            elif status == AgentStatus.LEAVING:
                # A heartbeat turns them back the same way a task does, while the car is still in its spot.
                await self._leave(agent_id, since, nxt is not None or working)
            elif nxt is not None:
                await self._work(agent_id, nxt.id)
            elif leave_at is not None and status in (AgentStatus.IDLE, AgentStatus.WAITING_REVIEW):
                # Let go with «Release all»: leaves at the planned time (nothing to work on, so allowed).
                due = (leave_at - now()).total_seconds()
                if due <= 0:
                    await self._set_status(agent_id, AgentStatus.LEAVING, expected=status)
                else:
                    await self._wait_poke(agent_id, due)
            elif working:
                await self._live(agent_id, live)
            elif any(t.status == TaskStatus.NEEDS_REVIEW for t in tasks):
                await self._set_status(agent_id, AgentStatus.WAITING_REVIEW, expected=status)
                await self._wait_poke(agent_id)
            else:
                # Nothing to do: the agent stays in the office until the director lets them go home.
                await self._set_status(agent_id, AgentStatus.IDLE, expected=status)
                await self._wait_poke(agent_id)

    async def _live(self, agent_id: int, live: dict[str, str] | None) -> None:
        """An outside process works through this agent: it stays at the desk while the heartbeats keep coming,
        and sits down by itself once the last one is older than `Timings.live`."""
        await self._set_status(agent_id, AgentStatus.WORKING)
        await self._wait_poke(agent_id, live_left(live, now(), self._t.live) or None)

    async def _clear_live(self, agent_id: int) -> None:
        """Drops a stale heartbeat of an agent who is not in the office, so `_sync_workers` stops starting a
        worker for it every tick."""
        async with self._sessions() as s:
            agent = await s.scalar(select(Agent).where(Agent.id == agent_id).with_for_update())
            if agent is None or agent.live is None or live_active(agent.live, now(), self._t.live):
                return
            agent.live = None
            await s.commit()

    async def _leave(self, agent_id: int, since: datetime, has_work: bool) -> None:
        """One step of a departure. Work that comes while the car is still in its spot turns the agent back;
        after that the car drives to the map edge and, if there is work, comes straight back."""
        elapsed = (now() - since).total_seconds()
        if has_work and elapsed < self._t.turn_back:
            await self._set_status(agent_id, AgentStatus.RETURNING, origin=since, expected=AgentStatus.LEAVING)
            return
        remaining = self._t.depart - elapsed
        if remaining > 0:
            await self._wait_poke(agent_id, remaining)
            return
        if has_work:
            await self._set_status(agent_id, AgentStatus.ARRIVING, origin=since, expected=AgentStatus.LEAVING)
        else:
            await self._set_status(agent_id, AgentStatus.OFF_SITE, expected=AgentStatus.LEAVING)

    @staticmethod
    def _remaining(duration: float, since: datetime) -> float:
        """Trips last `duration` from the status start, also across a server restart."""
        return duration - (now() - since).total_seconds()

    async def _load(
        self, agent_id: int
    ) -> tuple[AgentStatus, datetime, datetime | None, datetime | None, list[Task], dict[str, str] | None] | None:
        async with self._sessions() as s:
            agent = await s.scalar(
                select(Agent).where(Agent.id == agent_id).execution_options(populate_existing=True)
            )
            if agent is None or agent.archived_at is not None:
                return None
            tasks = (
                await s.scalars(
                    select(Task).where(Task.agent_id == agent_id, Task.status.in_(rules.ACTIVE_STATUSES))
                )
            ).all()
            return agent.status, agent.status_since, agent.trip_origin_at, agent.leave_at, list(tasks), agent.live

    async def _set_status(
        self, agent_id: int, status: AgentStatus, origin: datetime | None = None, expected: AgentStatus | None = None
    ) -> None:
        """`expected`: the status the decision was based on; if the director changed it meanwhile (sent the agent
        home), nothing is changed and the loop decides again."""
        async with self._sessions() as s:
            agent = await s.scalar(select(Agent).where(Agent.id == agent_id).with_for_update())
            if agent is None or agent.archived_at is not None or agent.status == status:
                return
            if expected is not None and agent.status != expected:
                return
            agent.set_status(status, now(), origin)
            await s.commit()
        publish_agent(agent_id, status)

    async def _set_activity(self, agent_id: int, kind: ActivityKind) -> None:
        """Waiting for / back on the model, only while the agent is at work (a status change always wins)."""
        async with self._sessions() as s:
            agent = await s.scalar(select(Agent).where(Agent.id == agent_id).with_for_update())
            if agent is None or agent.status != AgentStatus.WORKING:
                return
            before = list(agent.activity_log or [])
            agent.set_activity(kind, now())
            changed = agent.activity_log != before
            await s.commit()
        if changed:
            publish_agent(agent_id, AgentStatus.WORKING)

    # ---------- task work ----------

    async def _work(self, agent_id: int, task_id: int) -> None:
        started = await self._start_task(agent_id, task_id)
        if started is None:
            return
        agent, version = started
        await self._set_status(agent_id, AgentStatus.WORKING)
        stages = rules.task_stages(web_access=agent.web_access, version=version, tools=agent.tools)

        while not self._stop.is_set():
            begun = await self._begin_stage(task_id, stages, version, agent)
            if begun is None:
                return
            if isinstance(begun, str):
                await self._finish(task_id, version)
                return
            run_id, data = begun
            outcome = await self._execute(_RunReport(self, run_id, task_id, agent_id), data)
            await self._record(task_id, run_id, outcome)
            if not isinstance(outcome, StageOutput):
                return

    async def _lock_task(self, s: AsyncSession, task_id: int) -> Task | None:
        return await s.scalar(
            select(Task).where(Task.id == task_id).with_for_update().execution_options(populate_existing=True)
        )

    async def _start_task(self, agent_id: int, task_id: int) -> tuple[AgentSnapshot, int] | None:
        async with self._sessions() as s:
            task = await self._lock_task(s, task_id)
            if task is None or task.agent_id != agent_id or task.status not in WORKABLE:
                return None
            moved = task.status != TaskStatus.IN_PROGRESS
            if moved:
                apply_transition(task, TaskStatus.IN_PROGRESS, now())
            agent = await s.get_one(Agent, agent_id)
            versions = await s.scalar(select(func.count()).select_from(Artifact).where(Artifact.task_id == task_id))
            snapshot = AgentSnapshot(
                id=agent.id,
                name=agent.name,
                title=agent.title,
                system_prompt=agent.system_prompt,
                model=agent.model,
                web_access=agent.web_access,
                tools=tuple(agent.tools or ()),
            )
            await s.commit()
        if moved:
            publish_task(task)
        return snapshot, (versions or 0) + 1

    async def _begin_stage(
        self, task_id: int, stages: tuple[TaskStage, ...], version: int, agent: AgentSnapshot
    ) -> tuple[int, StageInput] | Literal["finished"] | None:
        """Picks the next stage of this version and opens a run for it. A task that left `in_progress`
        (paused, cancelled, put back in the queue) stops here — that is the stage boundary."""
        async with self._sessions() as s:
            task = await self._lock_task(s, task_id)
            if task is None or task.status != TaskStatus.IN_PROGRESS:
                return None
            done_runs = (
                await s.scalars(
                    select(Run)
                    .where(Run.task_id == task_id, Run.attempt == version, Run.status == RunStatus.SUCCEEDED)
                    .order_by(Run.id)
                )
            ).all()
            stage = rules.next_stage(stages, (r.stage for r in done_runs))
            if stage is None:
                return "finished"

            changed = task.stage != stage
            task.stage = stage
            run = Run(
                task_id=task_id,
                stage=stage,
                attempt=version,
                provider=self._worker.provider,
                model=self._worker.model_for(agent),
                status=RunStatus.RUNNING,
                started_at=now(),
            )
            s.add(run)
            profile = await s.get(Profile, PROFILE_ID)
            comments = (
                await s.scalars(select(TaskComment).where(TaskComment.task_id == task_id).order_by(TaskComment.id))
            ).all()
            results = (
                await s.scalars(select(Artifact.content).where(Artifact.task_id == task_id).order_by(Artifact.version))
            ).all()
            job_reports = (await s.scalars(select(Run.jobs).where(Run.task_id == task_id, Run.jobs.is_not(None)))).all()
            data = StageInput(
                task=TaskSnapshot(id=task.id, title=task.title, description=task.description),
                stage=stage,
                version=version,
                profile=ProfileSnapshot(
                    name=profile.name if profile else "",
                    summary=profile.summary if profile else "",
                    goal=profile.goal if profile else "",
                    constraints=profile.constraints if profile else "",
                    notes=profile.notes if profile else "",
                ),
                agent=agent,
                comments=tuple(CommentSnapshot(c.author, c.body, c.created_at) for c in comments),
                previous_stages={r.stage: r.output for r in done_runs},
                previous_results=tuple(results),
                jobs=next((r.jobs for r in reversed(done_runs) if r.jobs is not None), None),
                job_calls_used=sum(int(j.get("calls") or 0) for j in job_reports),
            )
            await s.commit()
            run_id = run.id
        if changed:
            publish_task(task)
        return run_id, data

    async def _execute(self, report: _RunReport, data: StageInput) -> StageOutput | BaseException | _Cancelled | _Paused:
        """Runs the stage; a cancelled task stops it right away; a pause waits for the boundary unless the model
        request has not gone out yet (queued, or Ollama out of reach), then it stops right away too.
        While it runs, partial text is saved every `Timings.progress` seconds."""
        work = asyncio.create_task(self._worker.run(data, report))
        poke = self._poke(report.agent_id)
        wake = min(self._t.tick, self._t.progress)
        try:
            while True:
                poke.clear()
                waiter = asyncio.create_task(poke.wait())
                done, _ = await asyncio.wait({work, waiter}, timeout=wake, return_when=asyncio.FIRST_COMPLETED)
                waiter.cancel()
                if work in done:
                    break
                await report.flush()
                status = await self._task_status(report.task_id)
                if status == TaskStatus.CANCELLED or (status == TaskStatus.PAUSED and not report.sent):
                    work.cancel()
                    await asyncio.gather(work, return_exceptions=True)
                    return CANCELLED if status == TaskStatus.CANCELLED else PAUSED
        finally:
            if not work.done():
                work.cancel()
        if work.cancelled():
            return CANCELLED
        return work.exception() or work.result()

    async def _set_run_status(self, report: _RunReport, status: RunStatus, **reason: object) -> None:
        """`reason`: why a run waits (error, error_code, error_params); cleared on any other change."""
        values: dict[str, object] = {"status": status, "error": None, "error_code": None, "error_params": None, **reason}
        if status == RunStatus.RUNNING:
            values["started_at"] = now()
        async with self._sessions() as s:
            await s.execute(
                update(Run)
                .where(Run.id == report.run_id, Run.status.in_([RunStatus.RUNNING, RunStatus.WAITING]))
                .values(**values)
            )
            await s.commit()
        publish_run(report.task_id, report.agent_id, report.run_id, status)

    async def _task_status(self, task_id: int) -> TaskStatus | None:
        async with self._sessions() as s:
            return await s.scalar(select(Task.status).where(Task.id == task_id))

    async def _record(self, task_id: int, run_id: int, outcome: StageOutput | BaseException | _Cancelled | _Paused) -> None:
        failed_task: Task | None = None
        async with self._sessions() as s:
            run = await s.get_one(Run, run_id, with_for_update=True)
            stage = run.stage
            run.finished_at = now()
            if isinstance(outcome, StageOutput):
                run.status = RunStatus.SUCCEEDED
                run.output = outcome.text
                run.sources = list(outcome.sources)
                run.input_tokens = outcome.input_tokens
                run.output_tokens = outcome.output_tokens
                run.tokens_per_second = outcome.tokens_per_second
                run.jobs = dict(outcome.jobs) if outcome.jobs is not None else None
            elif isinstance(outcome, _Cancelled):
                run.status = RunStatus.CANCELLED
            elif isinstance(outcome, _Paused):
                run.status = RunStatus.INTERRUPTED
                run.error, run.error_code, run.error_params = "Paused before the model started", "paused_waiting", {}
            else:
                run.status = RunStatus.FAILED
                run.error = str(outcome) if isinstance(outcome, StageError) else f"{type(outcome).__name__}: {outcome}"
                if isinstance(outcome, StageError) and outcome.code:
                    run.error_code, run.error_params = outcome.code, dict(outcome.params)
                task = await self._lock_task(s, task_id)
                if task is not None and task.status == TaskStatus.IN_PROGRESS:
                    apply_transition(task, TaskStatus.FAILED, now())
                    failed_task = task
            await s.commit()
        if failed_task is not None:
            log.warning("task %s failed at stage %s: %s", task_id, stage, outcome)
            publish_task(failed_task)

    async def _finish(self, task_id: int, version: int) -> None:
        """The last stage's text becomes the next version of the result; the task goes to review."""
        async with self._sessions() as s:
            task = await self._lock_task(s, task_id)
            if task is None or task.status != TaskStatus.IN_PROGRESS:
                return
            runs = (
                await s.scalars(
                    select(Run)
                    .where(Run.task_id == task_id, Run.attempt == version, Run.status == RunStatus.SUCCEEDED)
                    .order_by(Run.id)
                )
            ).all()
            sources = list(dict.fromkeys(src for r in runs for src in r.sources))
            jobs = next((r.jobs for r in reversed(runs) if r.jobs is not None), None)
            s.add(Artifact(task_id=task_id, version=version, content=runs[-1].output if runs else "", sources=sources, jobs=jobs))
            apply_transition(task, TaskStatus.NEEDS_REVIEW, now())
            await s.commit()
        publish_artifact(task_id, task.agent_id, version)
        publish_task(task)

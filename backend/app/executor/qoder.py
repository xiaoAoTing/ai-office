"""One stage of a task, done by the Qoder CLI instead of a local model.

`QoderWorker` sits behind the same `StageWorker` protocol as `LlmWorker` and `FakeWorker`, so the executor drives
agents, trips and review exactly as before. Each stage becomes one non-interactive `qoder -p` run: the stage's system
and user message go to `--system-prompt` and the query, and the streamed answer is reported as it grows.

The run is isolated from the operator's own setup: no MCP servers (`--strict-mcp-config` with an empty server map),
no built-in tools, no user/project settings, no session persistence. A stage therefore only writes text; the work
directory is an empty scratch directory, never the project.
"""

import asyncio
import json
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.executor.prompt import build_messages, reserve_tokens
from app.executor.worker import AgentSnapshot, StageError, StageInput, StageOutput, StageReport, estimate_tokens
from app.models.enums import RunProvider

MCP_NONE = '{"mcpServers":{}}'
"""An empty MCP map: with `--strict-mcp-config` the run sees no MCP server at all."""

STDERR_TAIL = 800
"""How much of the CLI's stderr is kept for the director's error text."""


@dataclass(frozen=True)
class QoderSettings:
    binary: str = "qoder"
    model: str | None = None
    """`None` or empty leaves the CLI's own default model in charge; an agent's `model` field wins over it."""
    num_ctx: int = 16384
    reserve_tokens: int = 6144
    concurrency: int = 1
    """Stages sent to the CLI at the same time."""
    idle_timeout_seconds: float = 900.0
    """A run counts as stuck after this long without a new event line; the CLI reports one line per
    completed message, so this has to cover a whole draft rather than a token gap."""
    timeout_seconds: float = 1800.0
    """Hard limit for one stage."""


class QoderWorker:
    provider = RunProvider.QODER

    def __init__(self, settings: QoderSettings) -> None:
        self.settings = settings
        self._gate = asyncio.Semaphore(settings.concurrency)

    def model_for(self, agent: AgentSnapshot) -> str | None:
        return agent.model or self.settings.model

    async def run(self, data: StageInput, report: StageReport) -> StageOutput:
        s = self.settings
        reserve = reserve_tokens(data, num_ctx=s.num_ctx, minimum=s.reserve_tokens, think_tokens=0)
        messages = build_messages(data, num_ctx=s.num_ctx, reserve_tokens=reserve)
        system, user = messages[0]["content"], messages[1]["content"]
        binary = shutil.which(s.binary)
        if binary is None:
            raise StageError(f"Qoder CLI `{s.binary}` was not found on PATH.", code="qoder_missing", params={"binary": s.binary})

        return await self._one_run(binary, system, user, data, report)

    async def _one_run(self, binary: str, system: str, user: str, data: StageInput, report: StageReport) -> StageOutput:
        s = self.settings
        args = [binary, "-p", "-o", "stream-json", "--system-prompt", system, "--no-session-persistence"]
        if s.model:
            args += ["-m", s.model]
        # `--tools` takes a list, so it goes last before the `--` that ends the options and starts the query.
        args += ["--strict-mcp-config", "--mcp-config", MCP_NONE, "--setting-sources", "", "--tools", "", "--", user]

        workdir = Path(tempfile.mkdtemp(prefix="ai-office-qoder-"))
        await self._gate.acquire()
        try:
            await report.waiting()
            try:
                proc = await asyncio.create_subprocess_exec(
                    *args,
                    cwd=str(workdir),
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    limit=8 * 1024 * 1024,
                )
            except OSError as error:
                raise StageError(f"Could not start the Qoder CLI: {error}", code="qoder_missing", params={"binary": s.binary}) from error
            await report.started()
            text = await self._collect(proc, report)
        finally:
            self._gate.release()
            shutil.rmtree(workdir, ignore_errors=True)

        if not text.strip():
            raise StageError("Qoder finished without writing any text.", code="qoder_no_text", params={"attempts": attempt})
        return StageOutput(
            text=text.strip(),
            input_tokens=estimate_tokens(system + user),
            output_tokens=estimate_tokens(text),
            sources=(),
        )

    async def _collect(self, proc: Any, report: StageReport) -> str:  # noqa: ANN401
        """Reads the event stream, showing the answer as it grows; returns the final text of the run."""
        s = self.settings
        parts: list[str] = []
        final: str | None = None
        loop = asyncio.get_running_loop()
        deadline = loop.time() + s.timeout_seconds

        while True:
            left = deadline - loop.time()
            if left <= 0:
                await self._kill(proc)
                raise StageError(
                    f"Qoder did not finish the stage within {s.timeout_seconds:.0f} s.",
                    code="qoder_timeout",
                    params={"seconds": int(s.timeout_seconds)},
                )
            assert proc.stdout is not None
            try:
                line = await asyncio.wait_for(proc.stdout.readline(), timeout=min(s.idle_timeout_seconds, left))
            except asyncio.TimeoutError:
                await self._kill(proc)
                raise StageError(
                    f"Qoder wrote nothing for {s.idle_timeout_seconds:.0f} s.",
                    code="qoder_stuck",
                    params={"seconds": int(s.idle_timeout_seconds)},
                ) from None
            if not line:
                break
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if not isinstance(event, dict):
                continue
            kind = event.get("type")
            if kind == "assistant":
                for block in (event.get("message") or {}).get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                        parts.append(str(block["text"]))
                        report.partial("".join(parts))
            elif kind == "result":
                final = event.get("result")
                if event.get("is_error"):
                    detail = str(final or event.get("subtype") or "unknown error")[:STDERR_TAIL]
                    await self._drain(proc)
                    raise StageError(f"Qoder returned an error: {detail}", code="qoder_error", params={"detail": detail})
        stderr = (await proc.stderr.read()).decode("utf-8", "replace") if proc.stderr else ""
        code = await proc.wait()
        if code != 0:
            detail = stderr.strip()[-STDERR_TAIL:] or f"exit code {code}"
            raise StageError(
                f"Qoder ended with an error ({detail}).",
                code="qoder_failed",
                params={"status": code, "detail": detail},
            )
        if final is not None and str(final).strip():
            return str(final)
        return "".join(parts)

    @staticmethod
    async def _kill(proc: Any) -> None:  # noqa: ANN401
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()

    @staticmethod
    async def _drain(proc: Any) -> None:  # noqa: ANN401
        try:
            await asyncio.wait_for(proc.wait(), timeout=10)
        except (asyncio.TimeoutError, OSError):
            await QoderWorker._kill(proc)

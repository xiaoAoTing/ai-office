from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str
    test_database_url: str | None = None
    cors_origins: list[str] = ["http://localhost:3000"]
    """Also the only origins allowed to send state-changing requests (`core/origin.py`)."""
    allowed_hosts: list[str] = ["localhost", "127.0.0.1"]
    api_docs: bool = False
    """/docs and /redoc (Swagger UI and ReDoc load their scripts from a CDN into the API's own origin)."""
    """Host header values the API answers; anything else (a DNS-rebinding page) gets 400."""

    executor_enabled: bool = True
    executor_arrive_seconds: float = 75.0
    """Trip from the map edge to the desk; the scene fits the whole animation into it."""
    executor_stage_seconds: float = 5.0
    executor_depart_seconds: float = 75.0
    executor_turn_back_seconds: float = 50.0
    """A departing car never leaves its spot before this; a task that comes earlier turns the agent back to the
    desk, a later one lets the car drive to the map edge and come straight back."""
    executor_return_extra_seconds: float = 12.0
    """A return lasts the time already spent leaving plus this (the worst case is turning just after the lift
    doors closed: down to the next stop and back up; measured in `check:layout`)."""
    executor_release_gap_seconds: float = 5.0
    """«Release all» sends people home this far apart, so the cars get through the exit barrier in time."""
    executor_tick_seconds: float = 1.0
    executor_worker: Literal["fake", "llm", "qoder"] = "fake"
    executor_progress_seconds: float = 1.0

    live_ttl_seconds: float = 180.0
    """How long an outside heartbeat (`POST /agents/{id}/live`) counts as work before the agent sits down."""

    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3.8:27b"
    ollama_num_ctx: int = 16384
    ollama_think: bool = True
    ollama_temperature: float = 0.3
    llm_concurrency: int = 1
    llm_idle_timeout_seconds: float = 120.0
    """A model call counts as stuck after this long without a new chunk (thinking or text); there is no total limit."""
    llm_retries: int = 1
    llm_reserve_tokens: int = 6144
    """Least part of the context window kept for the answer; the real reserve also counts thinking and the answer size."""
    llm_think_tokens: int = 6144
    """Room kept for the model's thinking (OLLAMA_THINK=true) on top of the expected answer."""
    llm_research_timeout_seconds: float = 900.0

    # Qoder CLI (EXECUTOR_WORKER=qoder): each stage is one non-interactive `qoder -p` run
    qoder_bin: str = "qoder"
    qoder_model: str = ""
    """Empty keeps the CLI's own default model; an agent's `model` field overrides it."""
    qoder_num_ctx: int = 16384
    """Budget the stage prompt is trimmed to, in the CLI's own token estimate."""
    qoder_reserve_tokens: int = 6144
    qoder_concurrency: int = 1
    """Stages sent to the CLI at the same time."""
    qoder_idle_timeout_seconds: float = 900.0
    """A stage counts as stuck after this long without a new event line; the CLI reports per completed
    message, not per token, so a long answer is silent by design."""
    qoder_timeout_seconds: float = 1800.0

    searxng_url: str = "http://127.0.0.1:8888"
    web_max_tool_calls: int = 8
    web_max_pages: int = 4
    web_page_chars: int = 4000
    web_max_bytes: int = 2_000_000
    web_tool_timeout_seconds: float = 15.0
    web_search_results: int = 8
    web_max_url_chars: int = 500
    web_max_query_chars: int = 200
    """Also the limit of a job search query and location."""

    adzuna_app_id: SecretStr | None = None
    adzuna_app_key: SecretStr | None = None
    reed_api_key: SecretStr | None = None
    """Job API keys: secrets, never printed or logged (an empty value means "not configured")."""
    jobs_max_calls: int = 10
    """search_jobs + get_job calls per task, across all its versions."""
    jobs_cache_seconds: float = 600.0
    jobs_failure_cache_seconds: float = 120.0
    """A failed job API request is not repeated for this long (the same search or advert gets the same error)."""
    adzuna_daily_limit: int = 100
    reed_daily_limit: int = 100
    """Requests per UTC day this app may send to each job API (0: none); the keys may be shared with other projects."""
    jobs_timeout_seconds: float = 15.0
    jobs_max_results: int = 50


@lru_cache
def get_settings() -> Settings:
    return Settings()

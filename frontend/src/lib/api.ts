import { API_URL } from "@/lib/config";

export type AgentStatus =
  | "off_site"
  | "arriving"
  | "idle"
  | "working"
  | "waiting_review"
  | "leaving"
  | "returning";

export type TaskStatus =
  | "queued"
  | "in_progress"
  | "paused"
  | "needs_review"
  | "changes_requested"
  | "done"
  | "failed"
  | "cancelled";

export type TaskStage = "plan" | "research" | "draft" | "self_check";

export type CurrentTask = {
  id: number;
  title: string;
  status: TaskStatus;
  stage: TaskStage | null;
  /** The running stage is queued for the model (GPU); the agent is still "working". */
  waiting_for_model: boolean;
  /** A web search or page read is running right now. */
  on_web: boolean;
  /** `waiting` for the model or `running`; null between stages. */
  run_state: "waiting" | "running" | null;
  /** The step running now: web search (target = query), page read (target = site), job search, job advert read. */
  web_step: { kind: WebStep["kind"]; target: string } | null;
};

export type ActivityKind = "off_site" | "arriving" | "working" | "waiting_model" | "waiting_review" | "idle" | "leaving" | "returning";
/** One entry of an agent's activity log (`since` ISO time). */
export type Activity = { kind: ActivityKind; since: string };
/** A heartbeat from an outside process: what it is doing now, said in its own words (`detail`). */
export type Live = { kind: string; detail: string; at: string };

/**
 * An agent's latest trip (kept after it ends): between the map edge and the desk, or back to the desk from a
 * departure. `origin_at`: start of the departure it continues — the one a return turned back from, or the one an
 * arrival came straight back from (the car drove to the map edge and returned).
 */
export type Trip = { kind: "arrive" | "depart" | "return"; started_at: string; origin_at?: string | null };

/** Why the director cannot send the agent home now. */
export type ReleaseBlocker = "tasks" | "on_the_way" | "away";

export type AgentState = {
  id: number;
  name: string;
  role_key: string;
  title: string;
  desk_index: number;
  status: AgentStatus;
  status_since: string;
  trip: Trip | null;
  /** Latest activities, oldest first (office life replays them). */
  activity_log: Activity[];
  /** Heartbeat from an outside process driving this agent (the Qoder CLI); null when nothing does. */
  live: Live | null;
  web_access: boolean;
  /** Tool sets besides the web, e.g. "jobs". */
  tools: AgentTool[];
  current_task: CurrentTask | null;
  queue_length: number;
  awaiting_review: number;
  /** null: can be sent home now. */
  release_blocked: ReleaseBlocker | null;
  /** Let go with «Release all»: leaves at this time (people go one after another). */
  leave_at: string | null;
};

export type FloorKind = "reception" | "office";

export type FloorState = {
  id: number;
  number: number;
  name: string;
  kind: FloorKind;
  capacity: number;
  has_director_office: boolean;
  has_server_room: boolean;
  has_kitchen: boolean;
  agents: AgentState[];
};

export type WorldStats = {
  tasks_in_progress: number;
  awaiting_review: number;
  done_today: number;
  model_busy: boolean;
  model_queue: number;
};

/**
 * Trip lengths (the scene fits each animation into them) and the server clock at the time of the response.
 * A departing car stays in its spot at least `turn_back_seconds`; a return lasts the time already spent leaving
 * plus `return_extra_seconds`.
 */
export type Motion = { arrive_seconds: number; depart_seconds: number; turn_back_seconds: number; return_extra_seconds: number; server_time: string };

export type ReleaseAllResult = { released: number[]; kept: Record<string, ReleaseBlocker> };

export type WorldState = {
  floors: FloorState[];
  stats: WorldStats;
  motion: Motion;
};

export type Agent = {
  id: number;
  floor_id: number | null;
  name: string;
  role_key: string;
  title: string;
  system_prompt: string;
  provider: string;
  model: string | null;
  web_access: boolean;
  tools: AgentTool[];
  desk_index: number | null;
  status: AgentStatus;
  archived_at: string | null;
};

/** Tool sets an agent may have besides the web: "jobs" = search_jobs / get_job (Adzuna, Reed). */
export type AgentTool = "jobs";

export type AgentCreate = {
  floor_id: number;
  desk_index: number;
  name: string;
  role_key: string;
  title: string;
  system_prompt: string;
};

export type AgentUpdate = Partial<Pick<Agent, "title" | "system_prompt" | "model" | "web_access" | "tools">>;

export type Task = {
  id: number;
  agent_id: number;
  title: string;
  description: string;
  status: TaskStatus;
  stage: TaskStage | null;
  position: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type Comment = { id: number; author: "director" | "agent"; body: string; created_at: string };

export type WebStep = {
  id: number;
  /** search / fetch: the web; jobs: a job search (target = "query · place"); job: reading a job advert. */
  kind: "search" | "fetch" | "jobs" | "job";
  target: string;
  status: "running" | "done" | "failed" | "blocked";
  /** In English; `detail_code` + `detail_params` give it in the interface language (`stepDetail` in the dictionaries). */
  detail?: string;
  detail_code?: string;
  detail_params?: Record<string, string | number>;
  source?: number;
  url?: string;
  /** Job search: vacancies found (before the filter), excluded by it and closed according to the source. */
  found?: number;
  excluded?: number;
  expired?: number;
};

export type JobExclusion = { reason: string; phrase: string };

/** Is a vacancy still open: from a source's API or its advert page; `unchecked` when neither could tell. */
export type Freshness = "open" | "expired" | "unchecked";

export type JobRow = {
  ref: string;
  title: string;
  company: string;
  location: string;
  url: string;
  links: Record<string, string>;
  salary: string;
  posted: string | null;
  full: boolean;
  exclusions: JobExclusion[];
  /** Absent in results saved before freshness was tracked. */
  freshness?: Freshness;
  freshness_note?: string;
  expires?: string | null;
};

export type TaskPage = { url: string; freshness: Freshness; note: string };

/** What the job tools found for one version: usable vacancies, excluded and closed ones with reasons, failures. */
export type JobsReport = {
  calls: number;
  jobs: JobRow[];
  excluded: JobRow[];
  expired?: JobRow[];
  summary: string;
  failures: Record<string, string>;
  /** The vacancy in the task itself failed the filter (review mode): no application is prepared. */
  task_flags: (JobExclusion & { where: string })[];
  /** Links in the task (the vacancy under review) and whether each is still open. */
  task_pages?: TaskPage[];
};

export type Run = {
  id: number;
  stage: TaskStage;
  attempt: number;
  provider: string;
  activity: WebStep[];
  jobs: JobsReport | null;
  tokens_per_second: number | null;
  sources: string[];
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  status: string;
  /** In English; `error_code` + `error_params` give it in the interface language (`stageError` in the dictionaries). */
  error: string | null;
  error_code?: string | null;
  error_params?: Record<string, unknown> | null;
  output: string;
  started_at: string;
  finished_at: string | null;
};

export type Artifact = { id: number; version: number; content: string; sources: string[]; jobs: JobsReport | null; created_at: string };

export type TaskDetail = Task & { comments: Comment[]; runs: Run[]; artifacts: Artifact[] };

export type Profile = { name: string; summary: string; goal: string; constraints: string; notes: string; updated_at: string };

export type ProfileUpdate = Omit<Profile, "updated_at">;

export type Floor = Omit<FloorState, "agents">;

export type LlmStatus = {
  worker: "fake" | "llm";
  ok: boolean;
  model: string | null;
  ollama: boolean | null;
  version: string | null;
  available: boolean | null;
  loaded: boolean | null;
  message: string | null;
  /** `modelStatus.<code>` in the dictionaries. */
  code?: "fake_worker" | "qoder_worker" | "ollama_down" | "model_missing" | null;
  params?: Record<string, string>;
};

export type ModelUser = { agent_id: number; name: string; title: string; task_title: string; stage: TaskStage; since: string };
export type TokenRow = { agent_id: number; name: string; title: string; today_in: number; today_out: number; total_in: number; total_out: number };

export type ServerRoom = {
  worker: "fake" | "llm";
  default_model: string;
  ollama: {
    up: boolean;
    url: string;
    version: string | null;
    models: { name: string; size_gb: number; vram_gb: number; context_length: number | null; expires_at: string | null }[];
  };
  gpu: { name: string; used_mb: number; total_mb: number; utilization: number } | null;
  searxng_up: boolean;
  searxng_url: string;
  /** Job APIs: keys set or not (values never sent) and how the latest request went. */
  job_sources: {
    name: string;
    label: string;
    configured: boolean;
    last_ok_at: string | null;
    last_error: string | null;
    last_error_at: string | null;
    /** API requests sent today (UTC) and the daily limit from backend/.env. */
    used_today: number;
    daily_limit: number;
  }[];
  last_speed: { tokens_per_second: number; model: string | null; agent_title: string; finished_at: string | null } | null;
  queue: ModelUser[];
  running: ModelUser[];
  tokens: TokenRow[];
  totals: { today_in: number; today_out: number; total_in: number; total_out: number };
};

export type ValidationIssue = { loc: (string | number)[]; msg: string; type: string; ctx?: Record<string, unknown> };

/** Non-2xx answer; `detail` is FastAPI's: a message for domain errors, a list of issues for validation. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string | ValidationIssue[] | null,
  ) {
    super(typeof detail === "string" ? detail : `HTTP ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method,
    cache: "no-store",
    signal,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { detail?: string | ValidationIssue[] } | null;
    throw new ApiError(res.status, payload?.detail ?? null);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const fetchState = (signal?: AbortSignal) => request<WorldState>("GET", "/state", undefined, signal);

export const api = {
  agent: (id: number, signal?: AbortSignal) => request<Agent>("GET", `/agents/${id}`, undefined, signal),
  createAgent: (data: AgentCreate) => request<Agent>("POST", "/agents", data),
  updateAgent: (id: number, data: AgentUpdate) => request<Agent>("PATCH", `/agents/${id}`, data),
  archiveAgent: (id: number) => request<void>("DELETE", `/agents/${id}`),
  releaseAgent: (id: number) => request<Agent>("POST", `/agents/${id}/release`),
  releaseAll: () => request<ReleaseAllResult>("POST", "/agents/release-all"),

  tasks: (signal?: AbortSignal) => request<Task[]>("GET", "/tasks", undefined, signal),
  task: (id: number, signal?: AbortSignal) => request<TaskDetail>("GET", `/tasks/${id}`, undefined, signal),
  createTask: (agentId: number, title: string, description: string) =>
    request<Task>("POST", "/tasks", { agent_id: agentId, title, description }),
  approve: (id: number) => request<TaskDetail>("POST", `/tasks/${id}/approve`),
  requestChanges: (id: number, body: string) => request<TaskDetail>("POST", `/tasks/${id}/request-changes`, { body }),
  pause: (id: number) => request<TaskDetail>("POST", `/tasks/${id}/pause`),
  resume: (id: number) => request<TaskDetail>("POST", `/tasks/${id}/resume`),
  retry: (id: number) => request<TaskDetail>("POST", `/tasks/${id}/retry`),
  cancel: (id: number) => request<TaskDetail>("POST", `/tasks/${id}/cancel`),
  comment: (id: number, body: string) => request<Comment>("POST", `/tasks/${id}/comments`, { body }),

  serverRoom: (signal?: AbortSignal) => request<ServerRoom>("GET", "/server-room", undefined, signal),
  llmStatus: (signal?: AbortSignal) => request<LlmStatus>("GET", "/llm/status", undefined, signal),

  profile: (signal?: AbortSignal) => request<Profile>("GET", "/profile", undefined, signal),
  saveProfile: (data: ProfileUpdate) => request<Profile>("PUT", "/profile", data),

  createFloor: (number: number, name: string, capacity: number) =>
    request<Floor>("POST", "/floors", { number, name, kind: "office", capacity }),
  deleteFloor: (id: number) => request<void>("DELETE", `/floors/${id}`),
};

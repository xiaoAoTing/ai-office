import type { AgentState, AgentStatus, JobsReport, Run, TaskStage, TaskStatus, WebStep } from "@/lib/api";
import type { Key, T } from "@/lib/i18n";

type Tag = { label: string; color: string };

export const AGENT_STATUS_COLOR: Record<AgentStatus, string> = {
  off_site: "#9aa0ab",
  arriving: "#4f8fe8",
  idle: "#2fbf83",
  working: "#f0a020",
  waiting_review: "#8b6cf0",
  leaving: "#4f8fe8",
  returning: "#4f8fe8",
};

export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  queued: "#7d8796",
  in_progress: "#f0a020",
  paused: "#b0a48f",
  needs_review: "#8b6cf0",
  changes_requested: "#ff7a59",
  done: "#2fbf83",
  failed: "#e5484d",
  cancelled: "#5c6370",
};

export const WAITING_FOR_MODEL_COLOR = "#6f9bc6";
const ON_WEB_COLOR = "#2a9fd6";

/** An outside process (the Qoder CLI) is driving this agent right now. */
const LIVE_COLOR = "#e0a33c";

/** What the outside process says it is doing, in its own words; shown instead of the inferred caption. */
function liveCaption(agent: Pick<AgentState, "status" | "live">): string | null {
  const live = agent.live;
  if (!live || live.kind === "idle" || !live.detail.trim()) return null;
  return agent.status === "working" || agent.status === "arriving" ? live.detail.trim() : null;
}

/** Statuses of an agent who is in the building (at the desk, resting, or walking back to the desk). */
export const IN_OFFICE: ReadonlySet<AgentStatus> = new Set(["idle", "working", "waiting_review", "returning"]);

export const taskTag = (t: T, status: TaskStatus): Tag => ({ label: t(`taskStatus.${status}`), color: TASK_STATUS_COLOR[status] });
export const stageName = (t: T, stage: TaskStage) => t(`taskStage.${stage}`);

/** Status tag of an agent as shown everywhere: "working" splits into working / waiting for the model. */
export function agentTag(t: T, agent: Pick<AgentState, "status" | "current_task" | "live">): Tag {
  const live = liveCaption(agent);
  if (live) return { label: live, color: LIVE_COLOR };
  if (agent.status === "working" && agent.current_task?.on_web) return { label: t("agentStatus.on_web"), color: ON_WEB_COLOR };
  if (agent.status === "working" && agent.current_task?.waiting_for_model) return { label: t("agentStatus.waiting_model"), color: WAITING_FOR_MODEL_COLOR };
  return { label: t(`agentStatus.${agent.status}`), color: AGENT_STATUS_COLOR[agent.status] };
}

/** Caption above an agent's head in office life, from what is really going on (never generated). */
export function activityCaption(t: T, agent: Pick<AgentState, "status" | "current_task" | "activity_log" | "live">): string | null {
  const live = liveCaption(agent);
  if (live) return live;
  const now = agent.activity_log.at(-1)?.kind;
  const task = agent.current_task;
  if (now === "waiting_model") return t("caption.waitingModel");
  if (now === "waiting_review" || agent.status === "waiting_review") return t("caption.waitingReview");
  if (now === "idle" || agent.status === "idle") return t("caption.resting");
  if (agent.status !== "working") return null;
  if (task?.web_step?.kind === "fetch") return t("caption.reading", { site: task.web_step.target });
  if (task?.web_step?.kind === "search") return t("caption.searchingWeb");
  if (task?.web_step?.kind === "jobs") return t("caption.searchingJobs");
  if (task?.web_step?.kind === "job") return t("caption.readingJob");
  if (task?.run_state === "waiting") return t("caption.waitingModel");
  return task?.stage ? t(`caption.${task.stage}`) : t("caption.working");
}

const EXCLUSION: [RegExp, Key][] = [
  [/^security clearance/, "exclusion.clearance"],
  [/residency/, "exclusion.residency"],
  [/nationality|citizenship/, "exclusion.nationality"],
];

/** The interface name of a hard-filter reason sent by the backend (`app/jobs/eligibility.py`). */
export function exclusionReason(t: T, reason: string): string {
  const key = EXCLUSION.find(([re]) => re.test(reason))?.[1];
  return key ? t(key) : reason;
}

const FRESHNESS_NOTE: [RegExp, (t: T, m: RegExpMatchArray) => string][] = [
  [/^open until (\S+) \((\w+) API\)/, (t, m) => t("freshness.openUntil", { date: m[1], source: m[2] })],
  [/^closed on (\S+) \((\w+) API\)/, (t, m) => t("freshness.closedOn", { date: m[1], source: m[2] })],
  [/^(\w+) no longer lists it/, (t, m) => t("freshness.notListed", { source: m[1] })],
  [/^the advert page is gone \(HTTP (\d+)\)/, (t, m) => t("freshness.gone", { status: m[1] })],
  [/^the advert page says "(.+)"/, (t, m) => t("freshness.says", { phrase: m[1] })],
  [/^the advert page is up/, (t) => t("freshness.up")],
  [/^the site does not let automated requests in \(HTTP (\d+)\)/, (t, m) => t("freshness.refused", { status: m[1] })],
  [/^Adzuna's API gives no closing date/, (t) => t("freshness.adzunaNoDate")],
  [/^Reed gave no closing date/, (t) => t("freshness.reedNoDate")],
  [/^the page was not opened/, (t) => t("freshness.notOpened")],
];

/** A freshness note from the backend (`app/jobs/freshness.py`, the sources) in the interface language. */
export function freshnessNote(t: T, note: string | undefined): string {
  if (!note) return "";
  for (const [re, label] of FRESHNESS_NOTE) {
    const m = note.match(re);
    if (m) return label(t, m);
  }
  return note;
}

/** "found 20, excluded 2, closed 1" for a research stage that used the job tools. */
export function jobCounts(t: T, report: JobsReport): string {
  const closed = report.expired?.length ?? 0;
  const found = report.jobs.length + report.excluded.length + closed;
  return closed ? t("jobCounts.foundClosed", { found, excluded: report.excluded.length, closed }) : t("jobCounts.found", { found, excluded: report.excluded.length });
}

type Coded = { code?: string | null; params?: Record<string, unknown> | null; text?: string | null };

function coded(t: T, prefix: "stageError" | "stepDetail", { code, params, text }: Coded): string | null {
  if (code) {
    const values = Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, typeof v === "number" ? v : String(v)]));
    const shown = t(`${prefix}.${code}` as Key, values);
    if (shown !== `${prefix}.${code}`) return shown;
  }
  return text ?? null;
}

/** A failed run's error in the interface language (older runs without a code show their stored text). */
export function runError(t: T, run: Pick<Run, "error" | "error_code" | "error_params">): string | null {
  return coded(t, "stageError", { code: run.error_code, params: run.error_params, text: run.error });
}

/** A web or job step's detail in the interface language. */
function tryKey(t: T, key: string, fallback: string): string {
  const shown = t(key as Key);
  return shown === key ? fallback : shown;
}

export function stepDetail(t: T, step: WebStep): string | undefined {
  const detail = step.detail_code === "private_terms"
    ? t("stepDetail.private_terms", { kinds: String(step.detail_params?.kinds ?? "").split(", ").map((k) => tryKey(t, `privacyKind.${k}`, k)).join(", ") })
    : step.detail_code === "job_closed" ? t("stepDetail.job_closed", { note: freshnessNote(t, String(step.detail_params?.note ?? "")) })
    : step.detail_code === "job_not_eligible" ? t("stepDetail.job_not_eligible", { reason: exclusionReason(t, String(step.detail_params?.reason ?? "")) })
    : coded(t, "stepDetail", { code: step.detail_code, params: step.detail_params, text: step.detail });
  return detail ?? undefined;
}

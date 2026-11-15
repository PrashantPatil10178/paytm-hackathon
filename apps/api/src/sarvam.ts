/**
 * The Sarvam voice-agent REST client (apps.sarvam.ai): place an outbound call with the
 * "Aria · Sales Caller" app, read attempts and transcripts back, and turn either a webhook body or
 * an attempt into one normalised result.
 *
 * The API key is the `sarvam` connector's token (Control Room → Connectors), else SARVAM_API_KEY.
 * It is only ever sent to Sarvam in the X-API-Key header: never logged, never returned.
 */
import type { CallExtraction, CallOutcome, CallPurpose, CallStatus, InfoOutcome, TranscriptLine } from "@ph/shared";
import { eq, schema as s } from "@ph/db";
import { db } from "./db.ts";

const env = (name: string, fallback = "") => process.env[name]?.trim() || fallback;

export interface SarvamConfig {
  apiKey: string;
  baseUrl: string;
  orgId: string;
  workspaceId: string;
  appId: string;
  appVersion: number;
  /** "Aria · Support Caller": phones a customer for the details a support request is missing */
  supportAppId: string;
  supportAppVersion: number;
  /** Demo safety: when set, every support call rings this (verified) number instead of the customer's */
  supportTestNumber: string;
  connectionId: string;
  callerNumber: string;
}

/** Why calls can't be placed right now (missing settings, switched off), or the config to place them with. */
export async function sarvamConfig(): Promise<{ ok: true; config: SarvamConfig } | { ok: false; reason: string }> {
  const [[connector], [channel]] = await Promise.all([
    db.select().from(s.connectors).where(eq(s.connectors.id, "sarvam")),
    db.select().from(s.channels).where(eq(s.channels.id, "sarvam_voice")),
  ]);
  if (connector && !connector.enabled) return { ok: false, reason: "The Sarvam connector is turned off. Turn it on in Control Room → Connectors." };
  if (channel && !channel.enabled) return { ok: false, reason: "The Sarvam voice channel is turned off. Turn it on in Control Room → Channels." };
  const apiKey = connector?.token?.trim() || env("SARVAM_API_KEY");
  const missing = [
    !apiKey && "the Sarvam API key (Control Room → Connectors → Sarvam)",
    !env("SARVAM_ORG_ID") && "SARVAM_ORG_ID",
    !env("SARVAM_WORKSPACE_ID") && "SARVAM_WORKSPACE_ID",
  ].filter(Boolean);
  if (missing.length) return { ok: false, reason: `Voice calls aren't set up yet: add ${missing.join(", ")} (then restart the API for .env changes).` };
  const base = (connector?.base_url || "https://apps.sarvam.ai").replace(/\/+$/, "");
  return {
    ok: true,
    config: {
      apiKey,
      baseUrl: base.endsWith("/api") ? base : `${base}/api`,
      orgId: env("SARVAM_ORG_ID"),
      workspaceId: env("SARVAM_WORKSPACE_ID"),
      appId: env("SARVAM_APP_ID", "Aria---Sale-a01f8007-240c"),
      appVersion: Number(env("SARVAM_APP_VERSION", "1")) || 1,
      supportAppId: env("SARVAM_SUPPORT_APP_ID", "Aria---Supp-c275c85f-5a2e"),
      supportAppVersion: Number(env("SARVAM_SUPPORT_APP_VERSION", "1")) || 1,
      supportTestNumber: env("SARVAM_TEST_NUMBER"),
      connectionId: env("SARVAM_CONNECTION_ID", "50ccd51e-3f-4c3775cb-fbe7"),
      callerNumber: env("SARVAM_CALLER_NUMBER", "+918064260576"),
    },
  };
}

export class SarvamError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Sarvam's error bodies: FastAPI `{detail: string | [{msg, loc}]}` or analytics `{error|message}`. */
function errorText(status: number, data: unknown): string {
  const d = data as { detail?: unknown; error?: unknown; message?: unknown } | null;
  let text = "";
  if (typeof d?.detail === "string") text = d.detail;
  else if (Array.isArray(d?.detail))
    text = d.detail.map((x: { msg?: string; loc?: unknown[] }) => [x.loc?.slice(1).join("."), x.msg].filter(Boolean).join(": ")).join("; ");
  else if (typeof d?.message === "string") text = d.message;
  else if (typeof d?.error === "string") text = d.error;
  else if (d?.error && typeof (d.error as { message?: unknown }).message === "string") text = (d.error as { message: string }).message;
  if (status === 401 || status === 403) text = `Sarvam refused the API key${text ? ` (${text})` : ""}. Check it in Control Room → Connectors.`;
  return `Sarvam ${status}: ${text || "no details"}`.slice(0, 500);
}

async function request<T>(cfg: SarvamConfig, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(cfg.baseUrl + path, {
      ...init,
      headers: { "X-API-Key": cfg.apiKey, "content-type": "application/json", accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new SarvamError(502, `Couldn't reach Sarvam (${e instanceof Error ? e.name : "network error"})`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new SarvamError(res.status, errorText(res.status, data));
  return data as T;
}

const seg = encodeURIComponent;

/** The Sarvam app (and version) that places calls of this purpose. */
export const appFor = (cfg: SarvamConfig, purpose: CallPurpose) =>
  purpose === "support" ? { id: cfg.supportAppId, version: cfg.supportAppVersion } : { id: cfg.appId, version: cfg.appVersion };

export interface OutboundCall {
  purpose?: CallPurpose;
  phone: string;
  variables: Record<string, string>;
  webhook?: { url: string; metadata: Record<string, string> };
}

/** Instant outbound call. Returns Sarvam's attempt id. */
export async function placeOutbound(cfg: SarvamConfig, call: OutboundCall): Promise<string> {
  const data = await request<{ attempt_id?: string }>(cfg, `/outbounds/v1/orgs/${seg(cfg.orgId)}/workspaces/${seg(cfg.workspaceId)}/outbounds`, {
    method: "POST",
    body: JSON.stringify({
      app_config: {
        app_id: appFor(cfg, call.purpose ?? "sales").id,
        app_version: appFor(cfg, call.purpose ?? "sales").version,
        app_type: "agent",
        connection_config: { connection_id: cfg.connectionId, agent_phone_number: cfg.callerNumber },
        agent_variables: call.variables,
      },
      user_config: { user_phone_number: call.phone },
      ...(call.webhook ? { webhook_config: call.webhook } : {}),
    }),
  });
  if (!data?.attempt_id) throw new SarvamError(502, "Sarvam accepted the call but sent no attempt_id");
  return data.attempt_id;
}

/** Sarvam's analytics timestamps are UTC with no offset. */
const sarvamTime = (d: Date) => d.toISOString().slice(0, 19);

/** Attempts of our app in a time window, newest first. Sarvam caches these for about a minute. */
export async function listAttempts(cfg: SarvamConfig, from: Date, to: Date, appId = cfg.appId): Promise<Record<string, unknown>[]> {
  const q = new URLSearchParams({
    start_datetime: sarvamTime(from),
    end_datetime: sarvamTime(to),
    sort_by: "attempted_at",
    sort_order: "desc",
    limit: "50",
  });
  const data = await request<{ items?: Record<string, unknown>[] }>(cfg, `/analytics/v1/${seg(cfg.orgId)}/${seg(cfg.workspaceId)}/${seg(appId)}/attempts?${q}`);
  return Array.isArray(data?.items) ? data.items : [];
}

/** A call's transcript by interaction id (`YYYYMMDD/<id>`; the slash is encoded). */
export async function getTranscript(cfg: SarvamConfig, interactionId: string, appId = cfg.appId): Promise<TranscriptLine[]> {
  const data = await request<{ messages?: unknown[] }>(cfg, `/analytics/v1/${seg(cfg.orgId)}/${seg(cfg.workspaceId)}/${seg(appId)}/transcripts/${seg(interactionId)}`);
  return toTranscript(data?.messages);
}

/* ───── Normalising what Sarvam sends back ───── */

/** One attempt's result, from a webhook body or an analytics attempt. */
export interface CallResult {
  attemptId: string | null;
  callId: number | null;
  /** null: Sarvam sent a status we don't know (the call's status is left alone) */
  status: CallStatus | null;
  durationS: number | null;
  interactionId: string | null;
  failure: string | null;
  extracted: CallExtraction;
  transcript: TranscriptLine[];
  endedAt: Date | null;
}

const STATUS: Record<string, CallStatus> = {
  connected: "completed",
  completed: "completed",
  no_answer: "no_answer",
  busy: "no_answer",
  not_answered: "no_answer",
  failed: "failed",
  in_progress: "in_progress",
  ongoing: "in_progress",
  ringing: "ringing",
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

function toTranscript(raw: unknown): TranscriptLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t: Record<string, unknown>) => {
    const text = str(t?.en_text) ?? str(t?.text) ?? str(t?.content) ?? str(t?.indic_text);
    if (!text) return [];
    return [{ role: String(t.role ?? "").toLowerCase() === "user" ? ("user" as const) : ("agent" as const), text }];
  });
}

/** Sarvam's UTC times have no offset ("2026-10-07T05:14:31"); read them as UTC. */
function toDate(v: unknown): Date | null {
  const t = str(v);
  if (!t) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const OUTCOMES: CallOutcome[] = ["meeting_booked", "send_details", "callback", "not_interested", "do_not_call", "wrong_person", "unclear"];
const enumOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => {
  const t = str(v)?.toLowerCase().replace(/[\s-]+/g, "_");
  return t && (allowed as readonly string[]).includes(t) ? (t as T) : undefined;
};
const INFO_OUTCOMES: InfoOutcome[] = ["info_collected", "partial", "callback", "declined", "wrong_person", "unclear"];
const EMPTY = new Set(["none", "null", "n/a", "na", "unknown", "not captured", "-"]);

/** The app's extracted fields, typed: numbers and booleans parsed, empty strings dropped. */
export function normaliseExtraction(vars: unknown): CallExtraction {
  if (!vars || typeof vars !== "object") return {};
  const v = vars as Record<string, unknown>;
  const text = (k: string) => {
    const t = str(v[k]);
    return t && !EMPTY.has(t.toLowerCase()) ? t : undefined;
  };
  const yes = (x: unknown) => {
    const t = typeof x === "boolean" ? String(x) : str(x)?.toLowerCase();
    return t === "true" || t === "yes" ? true : t === "false" || t === "no" ? false : undefined;
  };
  const budgetText = text("budget_inr")?.replace(/[₹,\s]|rs\.?|inr/gi, "");
  const budget = budgetText ? Math.round(Number(budgetText)) : NaN;
  const dm = yes(v.is_decision_maker);
  const out: CallExtraction = {
    call_outcome: enumOf(v.call_outcome, OUTCOMES),
    lead_score: enumOf(v.lead_score, ["hot", "warm", "cold"] as const),
    need: enumOf(v.need, ["bulk_order", "billing_setup", "payment_setup", "other", "not_discussed"] as const),
    start_when: text("start_when"),
    budget_inr: Number.isFinite(budget) && budget >= 0 ? budget : undefined,
    is_decision_maker: enumOf(v.is_decision_maker, ["yes", "no", "shared", "not_discussed"] as const) ?? (dm === undefined ? undefined : dm ? "yes" : "no"),
    whatsapp_ok: yes(v.whatsapp_ok),
    score_reason: text("score_reason"),
    contact_name_captured: text("contact_name_captured"),
    business_name_captured: text("business_name_captured"),
    business_type: text("business_type"),
    city: text("city"),
    current_setup: text("current_setup"),
    need_details: text("need_details"),
    monthly_volume: text("monthly_volume"),
    email: text("email")?.toLowerCase(),
    meeting_time: text("meeting_time"),
    objections: text("objections"),
    call_summary: text("call_summary"),
    info_outcome: enumOf(v.info_outcome, INFO_OUTCOMES),
    order_number: text("order_number")?.replace(/\D/g, "") || undefined,
    product: text("product"),
    issue_details: text("issue_details"),
    wants: enumOf(v.wants, ["refund", "replacement", "return", "cancel", "delivery_update", "information", "other", "not_discussed"] as const),
    best_time: text("best_time"),
    language_used: text("language_used"),
  };
  return Object.fromEntries(Object.entries(out).filter(([, x]) => x !== undefined)) as CallExtraction;
}

function result(p: Record<string, unknown>, statusKey: unknown, varsKey: unknown, durationKey: unknown, transcript: unknown): CallResult {
  const meta = (p.webhook_config as { metadata?: Record<string, unknown> } | undefined)?.metadata;
  const callId = Number(str(meta?.call_id));
  const failure = str(p.failure_reason);
  const duration = Number(str(durationKey));
  return {
    attemptId: str(p.attempt_id),
    callId: Number.isInteger(callId) && callId > 0 ? callId : null,
    status: STATUS[str(statusKey)?.toLowerCase() ?? ""] ?? null,
    durationS: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    interactionId: str(p.interaction_id),
    failure: failure && failure !== "NO_FAILURE_REASON" ? failure : null,
    extracted: normaliseExtraction(varsKey),
    transcript: toTranscript(transcript),
    endedAt: toDate(p.end_datetime),
  };
}

/** The webhook Sarvam sends after an attempt (instant-outbound or campaign shape). */
export function parseWebhook(raw: unknown): CallResult {
  let p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!p.attempt_id && p.data && typeof p.data === "object") p = p.data as Record<string, unknown>;
  return result(
    p,
    p.status ?? p.connectivity_status,
    p.final_agent_variables ?? p.output_agent_variables ?? p.agent_variables,
    p.duration ?? p.duration_in_seconds,
    p.interaction_transcript ?? p.transcript,
  );
}

/** An attempt from the analytics API (transcript comes separately). */
export const parseAttempt = (a: Record<string, unknown>): CallResult =>
  result(a, a.connectivity_status, a.agent_variables, a.duration_in_seconds, undefined);

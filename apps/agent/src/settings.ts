/**
 * The Control Room settings, as the agents use them (GET /control-room/settings through platform.settings()).
 * Each one changes what happens; none of them can switch off a money rule:
 *
 * - autonomy (in business hours) / hours.afterHours (outside them): how far Aria goes alone
 *     suggest    → every refund waits in Approvals, whatever the amount
 *     approval   → refunds within the limit on clean cases; an unclear photo, a risk signal or more → Approvals
 *     autonomous → as approval, but within the limit an unclear photo no longer waits (a mismatched or reused
 *                  photo, a risk signal or an amount above the limit still does)
 * - refundLimit / verifiedDamageLimit / requireDamagePhotos: see criticality.ts and evidence.ts
 * - escalation.{fraud, legal, vip, negative}: criticality.ts
 * - playbooks.{support, sales}: service.ts (off = that agent doesn't act)
 * - agentName, tone, languages: every agent's instructions (withPersona)
 */
import type { Autonomy, Settings } from "@ph/shared/controlroom";
import type { DynamicValue } from "@voltagent/core";
import { AUTO_REFUND_LIMIT } from "./criticality.ts";

/** Same values as the demo API's DEFAULT_SETTINGS: used for any field the API doesn't send, or when it can't be reached. */
export const DEFAULT_SETTINGS: Settings = {
  agentName: "Aria",
  avatarColor: "#0F9D8A",
  tone: "Friendly",
  playbooks: { support: true, sales: true },
  autonomy: "approval",
  refundLimit: AUTO_REFUND_LIMIT,
  verifiedDamageLimit: AUTO_REFUND_LIMIT,
  requireDamagePhotos: true,
  escalation: { fraud: true, legal: true, vip: false, negative: true },
  languages: ["English", "Hindi", "Hinglish"],
  hours: { days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], from: "09:00", to: "21:00", afterHours: "autonomous" },
};

/** Settings from the API over the defaults, with nonsense values replaced by the default. */
export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const r = raw ?? {};
  const money = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const modes: Autonomy[] = ["suggest", "approval", "autonomous"];
  const mode = (v: unknown, d: Autonomy) => (modes.includes(v as Autonomy) ? (v as Autonomy) : d);
  const D = DEFAULT_SETTINGS;
  const esc = (r.escalation ?? {}) as Partial<Settings["escalation"]>;
  const hours = (r.hours ?? {}) as Partial<Settings["hours"]>;
  const refundLimit = money(r.refundLimit, D.refundLimit);
  return {
    agentName: typeof r.agentName === "string" && r.agentName.trim() ? r.agentName.trim().slice(0, 40) : D.agentName,
    avatarColor: typeof r.avatarColor === "string" ? r.avatarColor : D.avatarColor,
    tone: typeof r.tone === "string" && r.tone.trim() ? r.tone.trim().slice(0, 60) : D.tone,
    playbooks: { support: bool(r.playbooks?.support, true), sales: bool(r.playbooks?.sales, true) },
    autonomy: mode(r.autonomy, D.autonomy),
    refundLimit,
    // Not sent by an older API: the same as the refund limit, which changes nothing.
    verifiedDamageLimit: money(r.verifiedDamageLimit, refundLimit),
    requireDamagePhotos: bool(r.requireDamagePhotos, D.requireDamagePhotos),
    escalation: { fraud: bool(esc.fraud, true), legal: bool(esc.legal, true), vip: bool(esc.vip, false), negative: bool(esc.negative, true) },
    languages: Array.isArray(r.languages) && r.languages.length ? r.languages.filter((l): l is string => typeof l === "string") : D.languages,
    hours: {
      days: Array.isArray(hours.days) ? hours.days : D.hours.days,
      from: typeof hours.from === "string" && /^\d\d:\d\d$/.test(hours.from) ? hours.from : D.hours.from,
      to: typeof hours.to === "string" && /^\d\d:\d\d$/.test(hours.to) ? hours.to : D.hours.to,
      afterHours: mode(hours.afterHours, D.hours.afterHours),
    },
  };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Day and "HH:MM" in IST. */
function istNow(now: Date): { day: string; time: string; date: Date } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { day: parts.weekday!, time: `${parts.hour}:${parts.minute}`, date: now };
}

const inWindow = (time: string, from: string, to: string) => (from <= to ? time >= from && time < to : time >= from || time < to);

export interface Schedule {
  /** A person is around (Control Room business hours, IST) */
  inHours: boolean;
  /** The autonomy that applies right now: `autonomy` in hours, `hours.afterHours` outside them */
  mode: Autonomy;
  /** When a person is next around, e.g. "Mon 09:00", for customers; null in hours or when no day is set */
  back: string | null;
}

export function schedule(s: Settings, now = new Date()): Schedule {
  const { day, time } = istNow(now);
  const inHours = s.hours.days.includes(day) && inWindow(time, s.hours.from, s.hours.to);
  if (inHours) return { inHours, mode: s.autonomy, back: null };
  // The next opening: later today if it hasn't started yet, else the next working day.
  let back: string | null = null;
  const today = WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number]);
  for (let i = 0; i < 8 && !back; i++) {
    const d = WEEKDAYS[(today + i) % 7]!;
    if (!s.hours.days.includes(d)) continue;
    if (i === 0 && time >= s.hours.from) continue;
    back = i === 0 ? `today at ${s.hours.from}` : i === 1 ? `tomorrow at ${s.hours.from}` : `${d} at ${s.hours.from}`;
  }
  return { inHours, mode: s.hours.afterHours, back };
}

/** One line for prompts and notes: the mode now and why. */
export const modeLine = (sc: Schedule) =>
  `Autonomy now: ${sc.mode} (${sc.inHours ? "business hours" : `after hours${sc.back ? `; a person is back ${sc.back} IST` : ""}`})`;

export type SettingsSource = () => Promise<Settings>;

/** The persona section every agent's instructions end with: name, tone and languages from the Control Room. */
export function personaText(s: Settings, talksToCustomers: boolean): string {
  const lines = [`Persona (Control Room settings): your name is ${s.agentName}.`];
  if (talksToCustomers) {
    lines.push(`Tone of voice: ${s.tone}.`);
    lines.push(
      `Languages: reply in the customer's language when it is one of ${s.languages.join(", ")}; otherwise reply in ${s.languages[0] ?? "English"}. ` +
        `Hinglish means Hindi in Latin script mixed with English.`,
    );
  }
  return lines.join("\n");
}

/**
 * Instructions with the persona applied: "Aria" becomes the configured name, and the persona section is appended.
 * `inner` may already be dynamic (withPolicies). Without a settings source the instructions are left as they are.
 */
export function withPersona(inner: string | DynamicValue<string>, source: SettingsSource | undefined, talksToCustomers = true): string | DynamicValue<string> {
  if (!source) return inner;
  return async (opts) => {
    const base = typeof inner === "string" ? inner : await inner(opts);
    let s: Settings;
    try {
      s = await source();
    } catch {
      return base;
    }
    const named = s.agentName === "Aria" ? base : base.replace(/\bAria\b/g, s.agentName);
    return `${named}\n\n${personaText(s, talksToCustomers)}`;
  };
}

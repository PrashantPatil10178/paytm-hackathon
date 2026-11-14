import { BOT, cap, initials, type LeadScore } from "@ph/shared";
import { Bot, Flame, Snowflake, Thermometer } from "lucide-react";

const SCORE = {
  hot: { icon: Flame, cls: "bg-hot-wash text-hot" },
  warm: { icon: Thermometer, cls: "bg-warm-wash text-warm" },
  cold: { icon: Snowflake, cls: "bg-cold-wash text-cold" },
} as const;

export function ScoreBadge({ score }: { score: LeadScore }) {
  const { icon: Icon, cls } = SCORE[score];
  return (
    <span className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-semibold ${cls}`}>
      <Icon size={12} aria-hidden />
      {cap(score)}
    </span>
  );
}

export function AiTag() {
  return (
    <span className="inline-flex h-[18px] items-center rounded-[3px] bg-ai px-1.5 text-[11px] font-semibold tracking-wide text-white" title="Done by ResolveAI">
      AI
    </span>
  );
}

export function Owner({ name, short = false }: { name: string; short?: boolean }) {
  const label = short ? (name === BOT ? "ResolveAI" : (name.split("–")[0]?.trim() ?? name)) : name;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={name}>
      <Avatar name={name} size="sm" />
      {!(short && name === BOT) && <span className="truncate">{label}</span>}
      {name === BOT && <AiTag />}
    </span>
  );
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const dims = size === "sm" ? "size-5 text-[9px]" : "size-9 text-xs";
  const tone = name === BOT ? "bg-ai text-white" : "bg-[#eaf0f6] text-ink-2";
  return (
    <span className={`grid flex-none place-items-center rounded-full font-semibold ${dims} ${tone}`} aria-hidden>
      {name === BOT ? <Bot size={size === "sm" ? 12 : 16} /> : initials(name)}
    </span>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mb-4 rounded-[3px] border border-hot/30 bg-hot-wash px-4 py-3 text-hot" role="alert">
      {message}
    </p>
  );
}

/** Polling heartbeat. Turns into "Reconnecting…" while the API can't be reached. */
export function Live({ error, title }: { error: string | null; title: string }) {
  return error ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger" title={error}>
      <span className="size-2 rounded-full bg-danger" aria-hidden /> Reconnecting…
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2" title={title}>
      <span className="size-2 animate-pulse-ring rounded-full bg-ai" aria-hidden /> Live
    </span>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-0.5 text-ink-2">{sub}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}

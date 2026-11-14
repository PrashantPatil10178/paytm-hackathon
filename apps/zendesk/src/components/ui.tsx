import { BOT, cap, initials, type TicketPriority, type TicketStatus } from "@ph/shared";
import { ArrowUpRight } from "lucide-react";
import { ResolveAIGlyph } from "@ph/shared/brand";

const STATUS_CLS: Record<TicketStatus, string> = {
  new: "bg-st-new text-st-new-ink",
  open: "bg-st-open text-white",
  pending: "bg-st-pending text-white",
  solved: "bg-st-solved text-white",
};

export function StatusBadge({ status, compact = false }: { status: TicketStatus; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded font-semibold whitespace-nowrap ${STATUS_CLS[status]} ${
        compact ? "size-[18px] flex-none text-[11px]" : "h-5 px-2 text-xs"
      }`}
      title={cap(status)}
    >
      {compact ? status[0]!.toUpperCase() : cap(status)}
    </span>
  );
}

export function PriorityText({ priority }: { priority: TicketPriority }) {
  const cls = priority === "urgent" ? "font-semibold text-prio-urgent" : priority === "high" ? "font-semibold text-prio-high" : "";
  return <span className={cls}>{cap(priority)}</span>;
}

export function AiTag() {
  return (
    <span className="inline-flex h-[18px] items-center gap-0.5 rounded bg-ai pr-1.5 pl-1 text-[11px] font-bold tracking-wide text-white" title="Handled by ResolveAI">
      <ResolveAIGlyph size={13} />
      AI
    </span>
  );
}

export function EscalatedTag() {
  return (
    <span
      className="inline-flex h-5 items-center gap-0.5 rounded border border-ai px-1.5 text-[11px] font-semibold whitespace-nowrap text-ai"
      title="ResolveAI handed this ticket to a person"
    >
      <ArrowUpRight size={12} aria-hidden />
      Escalated by AI
    </span>
  );
}

/** Assignee name plus the AI marker the guide asks for (Z-4). */
export function Assignee({ name, escalated }: { name: string | null; escalated: boolean }) {
  if (!name) return <span className="text-ink-3">–</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{name}</span>
      {name === BOT ? <AiTag /> : escalated ? <EscalatedTag /> : null}
    </span>
  );
}

const AVATAR_TONE = {
  customer: "bg-line-2 text-ink-2",
  agent: "bg-kale text-white",
  bot: "bg-ai text-white",
} as const;

export function Avatar({ name, tone }: { name: string; tone: keyof typeof AVATAR_TONE }) {
  return (
    <span className={`grid size-8 flex-none place-items-center rounded-full text-xs font-bold ${AVATAR_TONE[tone]}`} aria-hidden>
      {tone === "bot" ? <ResolveAIGlyph size={20} /> : initials(name)}
    </span>
  );
}

/** Polling heartbeat. Turns into "Reconnecting…" while the API can't be reached. */
export function Live({ error, title }: { error: string | null; title: string }) {
  return error ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger" title={error}>
      <span className="size-2 rounded-full bg-danger" aria-hidden /> Reconnecting…
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-3" title={title}>
      <span className="size-2 animate-pulse-ring rounded-full bg-ai" aria-hidden /> Live
    </span>
  );
}

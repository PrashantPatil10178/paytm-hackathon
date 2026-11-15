import { BOT, type TicketSummary } from "@ph/shared";
import { navigate } from "@ph/shared/react";
import { X } from "lucide-react";
import { useEffect } from "react";
import { AiTag, EscalatedTag, StatusBadge } from "./ui.tsx";

const HOLD_MS = 7000;

/** Zendesk-style notification for a ticket the agent just created, shown only when it isn't on screen. */
export function Toasts({ items, onDismiss }: { items: TicketSummary[]; onDismiss: (id: number) => void }) {
  return (
    <ol className="pointer-events-none fixed top-16 right-4 z-30 grid w-[min(360px,calc(100vw-2rem))] gap-2" aria-live="polite" aria-label="New tickets">
      {items.map((t) => (
        <Toast key={t.id} t={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </ol>
  );
}

function Toast({ t, onDismiss }: { t: TicketSummary; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, HOLD_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <li className="pointer-events-auto flex animate-rise items-start gap-3 rounded-lg border border-line bg-paper p-3 shadow-[var(--shadow-pop)]">
      <button
        type="button"
        onClick={() => {
          navigate(`/tickets/${t.id}`);
          onDismiss();
        }}
        className="grid min-w-0 flex-1 cursor-pointer gap-1 text-left"
      >
        <span className="flex items-center gap-2">
          <StatusBadge status={t.status} compact />
          <span className="font-semibold">New ticket #{t.id}</span>
          {t.assignee === BOT ? <AiTag /> : t.escalated_by_ai ? <EscalatedTag /> : null}
        </span>
        <span className="truncate text-ink-2">{t.subject}</span>
        <span className="text-xs text-ink-3">
          {t.requester.name} · via {t.via === "chat" ? "ShopKart chat" : t.via === "voice" ? "Phone call" : t.via}
        </span>
      </button>
      <button type="button" onClick={onDismiss} aria-label={`Dismiss ticket #${t.id}`} className="grid size-7 flex-none cursor-pointer place-items-center rounded text-ink-3 hover:bg-wash hover:text-ink">
        <X size={14} />
      </button>
    </li>
  );
}

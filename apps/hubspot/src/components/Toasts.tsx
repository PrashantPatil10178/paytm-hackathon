import { DEAL_STAGES, rupees, type DealCard } from "@ph/shared";
import { navigate } from "@ph/shared/react";
import { X } from "lucide-react";
import { useEffect } from "react";
import { AiTag, ScoreBadge } from "./ui.tsx";

const HOLD_MS = 7000;

/** HubSpot-style notification for a deal the agent just created, shown when the board isn't open. */
export function Toasts({ items, onDismiss }: { items: DealCard[]; onDismiss: (id: number) => void }) {
  return (
    <ol className="pointer-events-none fixed top-[68px] right-4 z-30 grid w-[min(360px,calc(100vw-2rem))] gap-2" aria-live="polite" aria-label="New deals">
      {items.map((d) => (
        <Toast key={d.id} d={d} onDismiss={() => onDismiss(d.id)} />
      ))}
    </ol>
  );
}

function Toast({ d, onDismiss }: { d: DealCard; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, HOLD_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <li className="pointer-events-auto flex animate-[toast-in_0.4s_var(--ease-out)] items-start gap-3 rounded-[3px] border border-line bg-paper p-3 shadow-[0_12px_32px_-8px_rgb(45_62_80/0.35)]">
      <button
        type="button"
        onClick={() => {
          navigate(`/deals/${d.id}`);
          onDismiss();
        }}
        className="grid min-w-0 flex-1 cursor-pointer gap-1 text-left"
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          New deal <AiTag />
        </span>
        <span className="truncate font-semibold text-link">{d.name}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
          <span className="font-semibold text-ink tabular-nums">{rupees(d.amount)}</span>
          <span>{DEAL_STAGES.find((s) => s.id === d.stage)?.label}</span>
          <ScoreBadge score={d.score} />
        </span>
      </button>
      <button type="button" onClick={onDismiss} aria-label={`Dismiss ${d.name}`} className="grid size-7 flex-none cursor-pointer place-items-center rounded-[3px] text-ink-2 hover:bg-wash hover:text-ink">
        <X size={14} />
      </button>
    </li>
  );
}

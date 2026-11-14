import { BOT, DEAL_STAGES, SALES_REPS, rupees, shortDay, type DealCard, type DealStage, type LeadScore } from "@ph/shared";
import { api, linkProps, navigate, useArrivals, useChanged, type Poll } from "@ph/shared/react";
import { ArrowRight, CalendarDays } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ME } from "./Topbar.tsx";
import { ErrorBanner, Live, Owner, PageHead, ScoreBadge } from "./ui.tsx";

export interface DealsResponse {
  deals: DealCard[];
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Swap the board state inside a view transition so moved cards fly to their new column. */
function transition(update: () => void) {
  if (!document.startViewTransition || reducedMotion() || document.hidden) return update();
  document.startViewTransition(() => flushSync(update));
}

export function Board({ poll }: { poll: Poll<DealsResponse> }) {
  const [shown, setShown] = useState<DealCard[]>();
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const pending = useRef(new Map<number, DealStage>()); // optimistic drags not yet confirmed
  const humanMoved = useRef(new Set<string | number>());
  const [owner, setOwner] = useState("all");
  const [score, setScore] = useState<"all" | LeadScore>("all");
  const [dragOver, setDragOver] = useState<DealStage | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Merge each poll into the board, keeping optimistic drags until the API agrees.
  useEffect(() => {
    if (!poll.data) return;
    const next = poll.data.deals.map((d) => {
      const want = pending.current.get(d.id);
      if (want === undefined) return d;
      if (want === d.stage) {
        pending.current.delete(d.id);
        return d;
      }
      return { ...d, stage: want };
    });
    const prev = shownRef.current;
    const moved = !!prev && next.some((d) => prev.find((p) => p.id === d.id)?.stage !== d.stage);
    if (moved) transition(() => setShown(next));
    else setShown(next);
  }, [poll.data]);

  const deals = useMemo(
    () => (shown ?? []).filter((d) => (owner === "all" || d.owner === owner) && (score === "all" || d.score === score)),
    [shown, owner, score],
  );
  const ids = useMemo(() => shown?.map((d) => d.id), [shown]);
  const fresh = useArrivals(ids);
  const moved = useChanged(shown, (d) => d.id, (d) => d.stage, humanMoved);

  const move = async (id: number, stage: DealStage) => {
    const deal = shown?.find((d) => d.id === id);
    if (!deal || deal.stage === stage) return;
    pending.current.set(id, stage);
    humanMoved.current.add(id);
    transition(() => setShown((s) => s?.map((d) => (d.id === id ? { ...d, stage } : d))));
    try {
      setMoveError(null);
      await api.patch(`/crm/deals/${id}`, { stage, actor: "human", author: ME });
      await poll.refresh();
    } catch (e) {
      pending.current.delete(id);
      setMoveError(`Couldn't move “${deal.name}”: ${(e as Error).message}`);
      await poll.refresh();
    }
  };

  const total = deals.reduce((s, d) => s + d.amount, 0);

  return (
    <main className="px-4 py-6 sm:px-6">
      <PageHead title="Deals" sub={`Sales pipeline · ${deals.length} deals · ${rupees(total)}`}>
        <label>
          <span className="sr-only">Deal owner</span>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">All owners</option>
            {[BOT, ...SALES_REPS].map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Lead score</span>
          <select value={score} onChange={(e) => setScore(e.target.value as typeof score)}>
            <option value="all">All scores</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </select>
        </label>
        <Live error={poll.error} title="The board refreshes every 2 seconds" />
      </PageHead>

      <ErrorBanner message={moveError} />

      <div className="flex gap-3 overflow-x-auto pb-4" role="list" aria-label="Deal stages">
        {DEAL_STAGES.map((stage) => {
          const col = deals.filter((d) => d.stage === stage.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
          const over = dragOver === stage.id;
          return (
            <section
              key={stage.id}
              role="listitem"
              aria-labelledby={`col-${stage.id}`}
              className={`flex min-w-0 flex-[1_0_208px] flex-col rounded-[3px] border transition-colors ${
                over ? "border-orange bg-orange-wash" : "border-line-2 bg-[#eaf0f6]"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOver !== stage.id) setDragOver(stage.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = Number(e.dataTransfer.getData("text/plain"));
                if (id) move(id, stage.id);
              }}
            >
              <header className="border-b border-line-2 px-3 py-2.5">
                <h2 id={`col-${stage.id}`} className="flex items-center gap-2 text-xs font-semibold tracking-wide text-ink uppercase">
                  {stage.label}
                  <span className="rounded-full bg-paper px-2 py-px text-[11px] text-ink-2 tabular-nums">{col.length}</span>
                </h2>
                <p className="mt-1 text-xs text-ink-2">
                  Total: <strong className="text-ink tabular-nums">{rupees(col.reduce((s, d) => s + d.amount, 0))}</strong>
                </p>
              </header>
              <div className="flex min-h-40 flex-col gap-2 p-2">
                {col.map((d) => (
                  <Card key={d.id} deal={d} state={moved.has(d.id) ? "moved" : fresh.has(d.id) ? "fresh" : null} />
                ))}
                {!shown &&
                  Array.from({ length: stage.id === "new_lead" || stage.id === "qualified" ? 2 : 1 }, (_, i) => (
                    <div key={i} className="grid animate-pulse gap-2 rounded-[3px] border border-line bg-paper p-3" aria-hidden>
                      <span className="h-3.5 w-4/5 rounded bg-line-2" />
                      <span className="h-3 w-1/2 rounded bg-line-2" />
                      <span className="h-3 w-2/3 rounded bg-line-2" />
                      <span className="mt-1 h-5 w-1/3 rounded-full bg-line-2" />
                    </div>
                  ))}
                {shown && col.length === 0 && (
                  <p className="grid flex-1 place-items-center rounded-[3px] border border-dashed border-line text-xs text-ink-2">Drag a deal here</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-ink-2">Drag cards between stages. Moves you make are logged as {ME}.</p>
    </main>
  );
}

function Card({ deal: d, state }: { deal: DealCard; state: "moved" | "fresh" | null }) {
  const [dragging, setDragging] = useState(false);
  const ring = state === "moved" ? "ring-2 ring-orange" : state === "fresh" ? "ring-2 ring-ai animate-arrive" : "";
  return (
    <article
      className={`cursor-grab rounded-[3px] border border-line bg-paper p-3 shadow-[0_1px_2px_rgb(45_62_80/0.08)] transition-[box-shadow,opacity] hover:shadow-[0_4px_12px_rgb(45_62_80/0.14)] active:cursor-grabbing ${ring} ${
        dragging ? "opacity-40" : ""
      }`}
      style={{ viewTransitionName: `deal-${d.id}` }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(d.id));
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("a")) navigate(`/deals/${d.id}`);
      }}
    >
      {state && (
        <p
          className={`-mx-3 -mt-3 mb-2 rounded-t-[3px] px-3 py-1 text-[11px] font-semibold ${
            state === "moved" ? "bg-orange-wash text-orange-ink" : "bg-ai-wash text-ai"
          }`}
          role="status"
        >
          {state === "moved" ? "Moved by ResolveAI" : "New from ResolveAI"}
        </p>
      )}
      <h3 className="text-[13px] leading-snug font-semibold">
        <a className="link" {...linkProps(`/deals/${d.id}`)}>{d.name}</a>
      </h3>
      <dl className="mt-2 grid gap-0.5 text-xs">
        <div className="flex gap-1">
          <dt className="text-ink-2">Amount:</dt>
          <dd className="font-semibold tabular-nums">{rupees(d.amount)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-ink-2">Contact:</dt>
          <dd className="truncate">{d.contact.name}</dd>
        </div>
      </dl>
      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
        <ScoreBadge score={d.score} />
        <Owner name={d.owner} short />
      </div>
      {(d.next_step || d.meeting) && (
        <div className="mt-2.5 grid gap-1 border-t border-line-2 pt-2 text-xs text-ink-2">
          {d.next_step && (
            <p className="flex items-start gap-1.5">
              <ArrowRight size={13} className="mt-px flex-none" aria-hidden />
              <span>{d.next_step}</span>
            </p>
          )}
          {d.meeting && (
            <p className="flex items-center gap-1.5">
              <CalendarDays size={13} className="flex-none" aria-hidden />
              <span>Meeting {shortDay(d.meeting.start)}</span>
            </p>
          )}
        </div>
      )}
    </article>
  );
}

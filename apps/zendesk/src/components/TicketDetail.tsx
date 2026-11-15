import {
  BOT,
  SUPPORT_AGENTS,
  cap,
  fullDate,
  stamp,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
  type TicketSummary,
  type TicketType,
  type UpdateTicketBody,
  type ZdUser,
} from "@ph/shared";
import { api, linkProps, useArrivals, usePoll } from "@ph/shared/react";
import { ArrowLeft, ChevronDown, Lock, Mail, MessageSquare, Phone, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ME } from "./Topbar.tsx";
import { AiTag, Avatar, EscalatedTag, StatusBadge } from "./ui.tsx";

const block = "grid gap-3 border-b border-line-2 p-5";
const blockTitle = "text-xs font-semibold text-ink-3";

export function TicketDetail({ id }: { id: number }) {
  const ticket = usePoll<Ticket>(`/zendesk/tickets/${id}`);
  const t = ticket.data;
  const others = usePoll<{ user: ZdUser; tickets: TicketSummary[] }>(t ? `/zendesk/users/${t.requester.id}/tickets` : null, 4000);

  if (ticket.error && !t)
    return (
      <main className="flex-1 p-6">
        <p className="mb-4 rounded border border-danger/30 bg-danger-wash px-4 py-3 text-danger" role="alert">{ticket.error}</p>
        <a className="link" {...linkProps("/tickets?view=all_unsolved")}>Back to all unsolved tickets</a>
      </main>
    );
  if (!t) return <main className="flex-1 p-6 text-ink-3">Loading ticket #{id}…</main>;

  const update = async (patch: UpdateTicketBody) => {
    await api.patch(`/zendesk/tickets/${t.id}`, { ...patch, actor: "human" });
    await ticket.refresh();
  };

  return (
    <>
    {ticket.error && (
      <p className="flex-none border-b border-danger/30 bg-danger-wash px-6 py-2 text-danger" role="alert">
        Showing the last saved copy. {ticket.error} (the demo data may have been reset).
      </p>
    )}
    <main className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_320px] xl:overflow-hidden" aria-label={`Ticket #${t.id}`}>
      <section className="flex min-h-[70dvh] flex-col xl:min-h-0 xl:border-r xl:border-line">
        <header className="flex items-center gap-3 border-b border-line px-4 py-4 md:px-6">
          <a
            className="grid size-8 flex-none place-items-center rounded text-ink-3 hover:bg-wash hover:text-ink"
            {...linkProps("/tickets?view=all_unsolved")}
            aria-label="Back to the ticket list"
          >
            <ArrowLeft size={16} />
          </a>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold [overflow-wrap:anywhere]">{t.subject}</h1>
            <p className="text-ink-3">
              #{t.id} · via {t.via === "chat" ? "ShopKart chat" : t.via === "voice" ? "Phone call" : cap(t.via)} · {fullDate(t.created_at)}
            </p>
          </div>
          <StatusBadge status={t.status} />
        </header>
        <Thread ticket={t} />
        <Composer ticket={t} onSubmitted={ticket.refresh} />
      </section>

      <aside className="border-t border-line bg-paper xl:overflow-y-auto xl:border-t-0" aria-label="Ticket details">
        <section className={block}>
          <h2 className={blockTitle}>Requester</h2>
          <div className="flex items-center gap-3">
            <Avatar name={t.requester.name} tone="customer" />
            <div>
              <p className="font-semibold">{t.requester.name}</p>
              <p className="text-xs text-ink-3">Customer · ShopKart</p>
            </div>
          </div>
          <dl className="grid gap-1">
            <div className="flex items-center gap-2">
              <dt className="grid text-ink-3"><Mail size={14} aria-label="Email" /></dt>
              <dd className="[overflow-wrap:anywhere]">{t.requester.email}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="grid text-ink-3"><Phone size={14} aria-label="Phone" /></dt>
              <dd>{t.requester.phone || "–"}</dd>
            </div>
          </dl>
        </section>

        <section className={block}>
          <h2 className={blockTitle}>Ticket fields</h2>
          <Field label="Assignee">
            <select className="zd-select" value={t.assignee ?? ""} onChange={(e) => update({ assignee: e.target.value || null })}>
              <option value="">Unassigned</option>
              {[BOT, ...SUPPORT_AGENTS].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            {t.assignee === BOT ? <AiTag /> : t.escalated_by_ai ? <EscalatedTag /> : null}
          </Field>
          <Field label="Status">
            <select className="zd-select" value={t.status} onChange={(e) => update({ status: e.target.value as TicketStatus })}>
              {(["new", "open", "pending", "solved"] as const).map((s) => (
                <option key={s} value={s}>{cap(s)}</option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select className="zd-select" value={t.type} onChange={(e) => update({ type: e.target.value as TicketType })}>
              {(["question", "incident", "problem"] as const).map((s) => (
                <option key={s} value={s}>{cap(s)}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select className="zd-select" value={t.priority} onChange={(e) => update({ priority: e.target.value as TicketPriority })}>
              {(["low", "normal", "high", "urgent"] as const).map((s) => (
                <option key={s} value={s}>{cap(s)}</option>
              ))}
            </select>
          </Field>
          <Field label="Tags">
            <span className="flex flex-wrap gap-1">
              {t.tags.length ? (
                t.tags.map((tag) => (
                  <span key={tag} className="rounded bg-line-2 px-2 py-px text-xs">{tag}</span>
                ))
              ) : (
                <span className="text-ink-3">No tags</span>
              )}
            </span>
          </Field>
          {t.order_id && (
            <Field label="Order">
              <span className="font-semibold">#{t.order_id}</span>
            </Field>
          )}
          {t.status === "solved" && (
            <Field label="Satisfaction">
              {t.csat ? (
                <span className="inline-flex gap-0.5 text-line" role="img" aria-label={`${t.csat} out of 5 stars`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} size={14} className={n <= t.csat! ? "fill-star text-star" : undefined} aria-hidden />
                  ))}
                </span>
              ) : (
                <span className="text-ink-3">Not rated yet</span>
              )}
            </Field>
          )}
        </section>

        <section className={block}>
          <h2 className={blockTitle}>Other tickets from this customer</h2>
          <OtherTickets current={t.id} list={others.data?.tickets} />
        </section>
      </aside>
    </main>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold">{label}</span>
      <span className="flex flex-wrap items-center gap-2">{children}</span>
    </label>
  );
}

function OtherTickets({ current, list }: { current: number; list?: TicketSummary[] }) {
  if (!list) return <p className="text-xs text-ink-3">Loading…</p>;
  const rest = list.filter((x) => x.id !== current);
  if (!rest.length) return <p className="text-xs text-ink-3">This is their only ticket.</p>;
  return (
    <ul className="grid gap-1">
      {rest.map((o) => (
        <li key={o.id} className="flex items-center gap-2">
          <a
            {...linkProps(`/tickets/${o.id}`)}
            className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 rounded p-2 text-ink no-underline hover:bg-wash"
          >
            <StatusBadge status={o.status} compact />
            <span className="truncate font-semibold">{o.subject}</span>
            <span className="col-start-2 text-xs text-ink-3">#{o.id} · {stamp(o.updated_at)}</span>
          </a>
          {o.assignee === BOT && <AiTag />}
        </li>
      ))}
    </ul>
  );
}

function Thread({ ticket }: { ticket: Ticket }) {
  const ids = useMemo(() => ticket.comments.map((c) => c.id), [ticket.comments]);
  const fresh = useArrivals(ids);
  const end = useRef<HTMLDivElement>(null);
  const count = ticket.comments.length;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [count]);

  return (
    <ol className="flex flex-1 flex-col gap-5 overflow-y-auto bg-wash p-4 md:p-6" aria-label="Conversation">
      {ticket.comments.map((c) => {
        const right = c.author_type !== "customer";
        const isNew = fresh.has(c.id);
        const bubble = !c.public
          ? "border-note-line bg-note"
          : right
            ? `border-agent-line bg-agent ${isNew ? "animate-arrive" : ""}`
            : `border-line bg-paper ${isNew ? "animate-arrive" : ""}`;
        return (
          <li key={c.id} className={`flex max-w-full gap-3 md:max-w-[min(640px,88%)] ${right ? "flex-row-reverse self-end" : ""} ${isNew ? "animate-rise" : ""}`}>
            <Avatar name={c.author} tone={c.author_type} />
            <div className={`min-w-0 rounded-lg border px-4 py-3 ${bubble}`}>
              <p className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-semibold">{c.author}</span>
                {c.author === BOT && <AiTag />}
                {!c.public && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-note-ink">
                    <Lock size={12} aria-hidden /> Internal note
                  </span>
                )}
                <time dateTime={c.created_at} className="text-xs text-ink-3">{stamp(c.created_at)}</time>
              </p>
              <p className="max-w-[68ch] whitespace-pre-wrap [overflow-wrap:anywhere]">{c.body}</p>
            </div>
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}

const SUBMIT: TicketStatus[] = ["open", "pending", "solved"];

function Composer({ ticket, onSubmitted }: { ticket: Ticket; onSubmitted: () => Promise<void> }) {
  const [mode, setMode] = useState<"public" | "note">("public");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const defaultStatus: TicketStatus = ticket.status === "new" ? "open" : ticket.status;
  const note = mode === "note";

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const submit = async (status: TicketStatus) => {
    setMenu(false);
    setBusy(true);
    setError(null);
    try {
      if (text.trim()) {
        await api.post(`/zendesk/tickets/${ticket.id}/comments`, { body: text.trim(), public: !note, author: ME, author_type: "agent" });
      }
      const patch: UpdateTicketBody = { status, actor: "human" };
      if (!ticket.assignee) patch.assignee = ME;
      await api.patch(`/zendesk/tickets/${ticket.id}`, patch);
      setText("");
      await onSubmitted();
    } catch (e) {
      setError(`Couldn't submit: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const tab = (on: boolean) =>
    `inline-flex cursor-pointer items-center gap-1.5 border-b-2 py-1 font-semibold ${
      on ? (note ? "border-note-ink text-note-ink" : "border-ink text-ink") : "border-transparent text-ink-3 hover:text-ink"
    }`;
  const dark = "h-9 cursor-pointer bg-ink font-semibold whitespace-nowrap text-white hover:bg-[#1d252b] active:translate-y-px disabled:cursor-progress disabled:opacity-60";

  return (
    <form
      className={`border-t border-line px-4 pt-3 pb-4 transition-colors md:px-6 ${note ? "bg-note" : "bg-paper"}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit(defaultStatus);
      }}
    >
      <div className="mb-2 flex gap-4" role="tablist" aria-label="Reply type">
        <button type="button" role="tab" aria-selected={!note} onClick={() => setMode("public")} className={tab(!note)}>
          <MessageSquare size={14} aria-hidden /> Public reply
        </button>
        <button type="button" role="tab" aria-selected={note} onClick={() => setMode("note")} className={tab(note)}>
          <Lock size={14} aria-hidden /> Internal note
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(defaultStatus);
        }}
        placeholder={note ? "Add a note only your team can see…" : `Reply to ${ticket.requester.name.split(" ")[0]}…`}
        aria-label={note ? "Internal note" : "Public reply"}
        rows={3}
        className={`min-h-[72px] w-full resize-y rounded border bg-paper px-3 py-2 focus:border-link focus:ring-3 focus:ring-link/20 focus:outline-none ${
          note ? "border-note-line" : "border-line"
        }`}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-3">{note ? "Only your team sees internal notes" : `${ticket.requester.name} will see this reply`}</span>
        {error && <span className="text-xs text-danger" role="alert">{error}</span>}
        <div className="relative ml-auto inline-flex" ref={menuRef}>
          <button type="submit" disabled={busy} className={`${dark} inline-flex items-center gap-1.5 rounded-l px-4`}>
            {busy ? (
              "Submitting…"
            ) : (
              <>
                Submit as <StatusBadge status={defaultStatus} compact /> {cap(defaultStatus)}
              </>
            )}
          </button>
          <button
            type="button"
            className={`${dark} grid w-9 place-items-center rounded-r border-l border-white/25`}
            aria-label="Choose the status to submit as"
            aria-haspopup="menu"
            aria-expanded={menu}
            disabled={busy}
            onClick={() => setMenu((m) => !m)}
          >
            <ChevronDown size={16} />
          </button>
          {menu && (
            <ul className="absolute right-0 bottom-[calc(100%+6px)] z-10 min-w-[200px] rounded-lg border border-line bg-paper p-1 shadow-[var(--shadow-pop)]" role="menu">
              {SUBMIT.map((s) => (
                <li key={s} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => submit(s)}
                    className="flex h-9 w-full cursor-pointer items-center gap-1.5 rounded px-3 text-left hover:bg-wash"
                  >
                    Submit as <StatusBadge status={s} compact /> <span className="font-semibold">{cap(s)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </form>
  );
}

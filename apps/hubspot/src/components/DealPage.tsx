import {
  BOT,
  DEAL_STAGES,
  SALES_REPS,
  ago,
  cap,
  clock,
  dayLabel,
  fullDate,
  rupees,
  shortDay,
  type Activity,
  type ActivityType,
  type DealDetail,
  type DealStage,
  type LeadScore,
  type QuoteStatus,
  type UpdateDealBody,
} from "@ph/shared";
import { api, copyText, linkProps, useArrivals, usePoll } from "@ph/shared/react";
import { ArrowLeft, ArrowRightLeft, CalendarCheck, Check, Copy, Mail, Phone, ReceiptIndianRupee, StickyNote } from "lucide-react";
import { useMemo, useState } from "react";
import { ME } from "./Topbar.tsx";
import { AiTag, Avatar, ErrorBanner, Owner } from "./ui.tsx";

const ACTIVITY_META: Record<ActivityType, { icon: typeof StickyNote; label: string; tone: string }> = {
  note: { icon: StickyNote, label: "Note", tone: "bg-[#fef6d8] text-[#8a6100]" },
  email: { icon: Mail, label: "Email", tone: "bg-cold-wash text-cold" },
  meeting: { icon: CalendarCheck, label: "Meeting", tone: "bg-orange-wash text-orange-ink" },
  call: { icon: Phone, label: "Call", tone: "bg-[#e5f8f4] text-[#007a69]" },
  stage_change: { icon: ArrowRightLeft, label: "Stage change", tone: "bg-[#eaf0f6] text-ink-2" },
  quote: { icon: ReceiptIndianRupee, label: "Quote", tone: "bg-[#f1ecfb] text-[#5c3aa8]" },
};

const FILTERS: { id: "all" | ActivityType; label: string }[] = [
  { id: "all", label: "Activity" },
  { id: "note", label: "Notes" },
  { id: "email", label: "Emails" },
  { id: "meeting", label: "Meetings" },
];

const QUOTE: Record<QuoteStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-[#eaf0f6] text-ink-2" },
  waiting_approval: { label: "Waiting approval", cls: "bg-warm-wash text-warm" },
  sent: { label: "Sent", cls: "bg-[#e5f8f4] text-[#007a69]" },
};

export function DealPage({ id }: { id: number }) {
  const poll = usePoll<DealDetail>(`/crm/deals/${id}`);
  const d = poll.data;
  const [error, setError] = useState<string | null>(null);

  if (!d)
    return (
      <main className="px-4 py-6 sm:px-6">
        {poll.error ? <ErrorBanner message={poll.error} /> : <p className="text-ink-2">Loading deal…</p>}
        <a className="link" {...linkProps("/deals")}>Back to deals</a>
      </main>
    );

  const update = async (patch: UpdateDealBody) => {
    try {
      setError(null);
      await api.patch(`/crm/deals/${d.id}`, { ...patch, actor: "human", author: ME });
      await poll.refresh();
    } catch (e) {
      setError(`Couldn't save: ${(e as Error).message}`);
    }
  };

  return (
    <main className="px-4 py-5 sm:px-6">
      <a className="link mb-4 inline-flex items-center gap-1 text-[13px] font-semibold" {...linkProps("/deals")}>
        <ArrowLeft size={14} aria-hidden /> Deals
      </a>
      <ErrorBanner message={error ?? (poll.error && `Showing the last saved copy. ${poll.error} (the demo data may have been reset).`)} />
      <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <aside className="grid gap-4" aria-label="About this deal">
          <section className="box">
            <h1 className="text-lg leading-snug font-semibold text-ink">{d.name}</h1>
            <p className="mt-1 text-2xl font-semibold text-ink tabular-nums">{rupees(d.amount)}</p>
            <dl className="mt-4 grid gap-3">
              <Prop label="Deal stage">
                <select className="w-full" value={d.stage} onChange={(e) => update({ stage: e.target.value as DealStage })}>
                  {DEAL_STAGES.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </Prop>
              <Prop label="Lead score">
                <select className="w-full" value={d.score} onChange={(e) => update({ score: e.target.value as LeadScore })}>
                  {(["hot", "warm", "cold"] as const).map((s) => (
                    <option key={s} value={s}>{cap(s)}</option>
                  ))}
                </select>
              </Prop>
              <Prop label="Deal owner">
                <select className="w-full" value={d.owner} onChange={(e) => update({ owner: e.target.value })}>
                  {[BOT, ...SALES_REPS].map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </Prop>
              <Prop label="Close date">{shortDay(d.close_date)}</Prop>
              <Prop label="Next step">{d.next_step || "–"}</Prop>
              <Prop label="Create date">{fullDate(d.created_at)}</Prop>
            </dl>
          </section>
          <section className="box">
            <h2>Contact</h2>
            <a className="group flex items-center gap-3 no-underline" {...linkProps(`/contacts/${d.contact.id}`)}>
              <Avatar name={d.contact.name} />
              <span className="min-w-0">
                <span className="block font-semibold text-link group-hover:underline">{d.contact.name}</span>
                <span className="block text-xs text-ink-2">{d.contact.company}</span>
              </span>
            </a>
            <dl className="mt-4 grid gap-3">
              <Prop label="Email">{d.contact.email}</Prop>
              <Prop label="Phone">{d.contact.phone || "–"}</Prop>
              <Prop label="Lead status">{d.contact.lead_status}</Prop>
            </dl>
          </section>
        </aside>

        <Timeline deal={d} onLogged={poll.refresh} />

        <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:col-start-2 xl:col-start-auto" aria-label="Meeting, quote and payment">
          <section className="box">
            <h2>Meeting</h2>
            {d.meeting ? (
              <div className="flex gap-3">
                <div className="grid w-12 flex-none overflow-hidden rounded-[3px] border border-line text-center" aria-hidden>
                  <span className="bg-orange py-0.5 text-[10px] font-semibold text-white uppercase">
                    {new Date(d.meeting.start).toLocaleString("en-IN", { month: "short" })}
                  </span>
                  <strong className="py-1 text-lg">{new Date(d.meeting.start).getDate()}</strong>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{d.meeting.title}</p>
                  <p className="text-xs text-ink-2">
                    {shortDay(d.meeting.start)} · {clock(d.meeting.start)} · {d.meeting.duration_min} min
                  </p>
                  <p className="mt-1 text-xs">{d.meeting.attendees.join(", ")}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink-2">No meeting booked yet. ResolveAI books one when the lead picks a slot.</p>
            )}
          </section>

          <section className="box">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="box-title !mb-0">Quote</h2>
              {d.quote && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${QUOTE[d.quote.status].cls}`}>{QUOTE[d.quote.status].label}</span>}
            </div>
            {d.quote ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-2">
                    <th scope="col" className="pb-1.5 font-semibold">Item</th>
                    <th scope="col" className="pb-1.5 text-right font-semibold">Qty</th>
                    <th scope="col" className="pb-1.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {d.quote.items.map((i) => (
                    <tr key={i.name} className="border-t border-line-2">
                      <td className="py-1.5 pr-2">{i.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{i.qty}</td>
                      <td className="py-1.5 text-right tabular-nums">{rupees(i.qty * i.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line">
                    <th scope="row" colSpan={2} className="pt-2 text-left font-semibold">Total</th>
                    <td className="pt-2 text-right font-semibold tabular-nums">{rupees(d.quote.amount)}</td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <p className="text-xs text-ink-2">No quote yet.</p>
            )}
          </section>

          <section className="box">
            <h2>Payment link</h2>
            {d.payment_link ? <PaymentLink url={d.payment_link} /> : <p className="text-xs text-ink-2">Created once the quote is approved.</p>}
          </section>

          {d.tasks.length > 0 && (
            <section className="box">
              <h2>Tasks</h2>
              <ul className="grid gap-2">
                {d.tasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-2">
                    <span className={`mt-0.5 grid size-4 flex-none place-items-center rounded-full border ${t.done ? "border-success bg-success text-white" : "border-line"}`} aria-hidden>
                      {t.done && <Check size={10} />}
                    </span>
                    <span>
                      {t.title}
                      <span className="block text-xs text-ink-2">Due {shortDay(t.due)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-ink-2">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

function PaymentLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <a href={url} target="_blank" rel="noreferrer" title={url} className="link min-w-0 flex-1 truncate">
        {url.replace(/^https?:\/\//, "")}
      </a>
      <button
        type="button"
        className="btn-secondary"
        onClick={async () => {
          if (!(await copyText(url))) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Timeline({ deal, onLogged }: { deal: DealDetail; onLogged: () => Promise<void> }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useMemo(() => deal.activities.map((a) => a.id), [deal.activities]);
  const fresh = useArrivals(ids);
  const items = deal.activities.filter((a) => filter === "all" || a.type === filter);

  const log = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/crm/deals/${deal.id}/notes`, { body: note.trim(), author: ME, ai: false });
      setNote("");
      await onLogged();
    } catch (err) {
      setError(`Couldn't log the note: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="box !p-0" aria-label="Activity">
      <div className="flex gap-1 overflow-x-auto border-b border-line px-3" role="tablist" aria-label="Filter activity">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`relative h-11 cursor-pointer px-3 text-[13px] whitespace-nowrap ${
              filter === f.id
                ? "font-semibold text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t after:bg-orange"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <form className="border-b border-line-2 p-4" onSubmit={log}>
        <label htmlFor="note" className="sr-only">Log a note</label>
        <textarea
          id="note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Log a note about this deal…"
          className="w-full resize-y rounded-[3px] border border-line bg-paper px-3 py-2 placeholder:text-ink-2/80 focus:border-link focus:outline-none focus:ring-3 focus:ring-link/20"
        />
        <div className="mt-2 flex items-center justify-end gap-3">
          {error && <span className="text-xs text-danger" role="alert">{error}</span>}
          <button className="btn-primary" disabled={busy || !note.trim()}>
            {busy ? "Logging…" : "Log note"}
          </button>
        </div>
      </form>
      {items.length === 0 ? (
        <p className="p-6 text-center text-ink-2">
          No {filter === "all" ? "activity" : FILTERS.find((f) => f.id === filter)!.label.toLowerCase()} on this deal yet.
        </p>
      ) : (
        <div>
          {groupByDay(items).map(([day, group]) => (
            <section key={day} aria-label={day}>
              <h3 className="sticky top-14 z-[1] border-b border-line-2 bg-wash/95 px-4 py-1.5 text-xs font-semibold text-ink-2 backdrop-blur">{day}</h3>
              <ol className="grid">
                {group.map((a) => (
                  <ActivityItem key={a.id} a={a} fresh={fresh.has(a.id)} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/** Newest-first activity grouped under "Today", "Yesterday", "12 Nov", like HubSpot's timeline. */
function groupByDay(items: Activity[]): [string, Activity[]][] {
  const groups = new Map<string, Activity[]>();
  for (const a of items) {
    const key = dayLabel(a.created_at);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return [...groups];
}

function ActivityItem({ a, fresh }: { a: Activity; fresh: boolean }) {
  const meta = ACTIVITY_META[a.type];
  const Icon = meta.icon;
  return (
    <li className={`flex gap-3 border-b border-line-2 px-4 py-4 last:border-b-0 ${fresh ? "animate-arrive" : ""}`}>
      <span className={`grid size-8 flex-none place-items-center rounded-full ${meta.tone}`} aria-hidden>
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
          <span className="font-semibold">{meta.label}</span>
          <span className="text-ink-2">by</span>
          <Owner name={a.author} />
          {a.ai && a.author !== BOT && <AiTag />}
          <time className="ml-auto text-xs text-ink-2" dateTime={a.created_at} title={fullDate(a.created_at)}>
            {dayLabel(a.created_at) === "Today" ? ago(a.created_at) : clock(a.created_at)}
          </time>
        </p>
        <p className="mt-1 max-w-[68ch] whitespace-pre-wrap [overflow-wrap:anywhere]">{a.body}</p>
      </div>
    </li>
  );
}

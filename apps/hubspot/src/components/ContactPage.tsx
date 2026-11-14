import { DEAL_STAGES, fullDate, rupees, type Contact, type DealCard } from "@ph/shared";
import { linkProps, usePoll } from "@ph/shared/react";
import { ArrowLeft } from "lucide-react";
import { Avatar, ErrorBanner, Owner, ScoreBadge } from "./ui.tsx";

export function ContactPage({ id }: { id: number }) {
  const poll = usePoll<Contact & { deals: DealCard[] }>(`/crm/contacts/${id}`);
  const c = poll.data;

  return (
    <main className="px-4 py-5 sm:px-6">
      <a className="link mb-4 inline-flex items-center gap-1 text-[13px] font-semibold" {...linkProps("/contacts")}>
        <ArrowLeft size={14} aria-hidden /> Contacts
      </a>
      <ErrorBanner message={poll.error} />
      {!c ? (
        <p className="text-ink-2">Loading contact…</p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section className="box">
            <div className="mb-5 flex items-center gap-3">
              <Avatar name={c.name} />
              <div className="min-w-0">
                <h1 className="text-lg font-semibold">{c.name}</h1>
                <p className="text-ink-2">{c.company}</p>
              </div>
            </div>
            <dl className="grid gap-3">
              {(
                [
                  ["Email", c.email],
                  ["Phone number", c.phone || "–"],
                  ["Lead status", c.lead_status],
                  ["Contact owner", <Owner key="o" name={c.owner} />],
                  ["Source", c.source],
                  ["Create date", fullDate(c.created_at)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="grid gap-1">
                  <dt className="text-xs text-ink-2">{label}</dt>
                  <dd className="m-0 [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="box">
            <h2>Deals ({c.deals.length})</h2>
            {c.deals.length === 0 ? (
              <p className="text-xs text-ink-2">No deals for this contact yet.</p>
            ) : (
              <ul className="grid gap-2">
                {c.deals.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[3px] border border-line-2 p-3">
                    <div className="min-w-0 flex-1">
                      <a {...linkProps(`/deals/${d.id}`)} className="link font-semibold">{d.name}</a>
                      <p className="text-xs text-ink-2">
                        {DEAL_STAGES.find((s) => s.id === d.stage)?.label} · {rupees(d.amount)}
                      </p>
                    </div>
                    <ScoreBadge score={d.score} />
                    <Owner name={d.owner} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

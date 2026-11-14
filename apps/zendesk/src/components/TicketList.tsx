import { stamp, type TicketView } from "@ph/shared";
import { linkProps, navigate, useArrivals, useLocation, type Poll } from "@ph/shared/react";
import { useMemo } from "react";
import { VIEWS, type ListResponse } from "../views.ts";
import { Assignee, Live, PriorityText, StatusBadge } from "./ui.tsx";

const th = "border-b border-line bg-wash px-4 py-3 text-left text-xs font-semibold whitespace-nowrap text-ink-3";
const td = "border-b border-line-2 px-4 py-3 align-middle";

export function TicketList({ view, list }: { view: TicketView; list: Poll<ListResponse> }) {
  const { query } = useLocation();
  const q = (query.get("q") ?? "").toLowerCase();
  const label = VIEWS.find((v) => v.id === view)?.label ?? "Tickets";

  // Ignore a stale payload from the previous view while the new one loads.
  const data = list.data?.view === view ? list.data : undefined;
  const tickets = useMemo(
    () =>
      (data?.tickets ?? []).filter(
        (t) => !q || String(t.id).includes(q.replace("#", "")) || t.requester.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q),
      ),
    [data, q],
  );
  const ids = useMemo(() => data?.tickets.map((t) => t.id), [data]);
  const fresh = useArrivals(ids);

  return (
    <main className="flex-1 overflow-auto p-4 md:p-6" aria-labelledby="view-title">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 id="view-title" className="text-[22px] font-semibold tracking-tight">{label}</h1>
          <p className="mt-0.5 text-ink-3">
            {data ? `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}` : "Loading tickets…"}
            {q && (
              <>
                {" "}matching “{query.get("q")}” ·{" "}
                <a className="link" {...linkProps(`/tickets?view=${view}`)}>Clear search</a>
              </>
            )}
          </p>
        </div>
        <Live error={list.error} title="This list refreshes every 2 seconds" />
      </div>

      {list.error && (
        <p className="mb-4 rounded border border-danger/30 bg-danger-wash px-4 py-3 text-danger" role="alert">
          {list.error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr>
              <th scope="col" className={th}>Ticket</th>
              <th scope="col" className={th}>Subject</th>
              <th scope="col" className={th}>Requester</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={th}>Priority</th>
              <th scope="col" className={th}>Assignee</th>
              <th scope="col" className={th}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {!data &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i} aria-hidden>
                  {[48, 260, 110, 56, 60, 130, 90].map((w, j) => (
                    <td key={j} className={td}>
                      <span className="block h-3.5 animate-pulse rounded bg-line-2" style={{ width: w }} />
                    </td>
                  ))}
                </tr>
              ))}
            {tickets.map((t) => (
              <tr
                key={t.id}
                className={`cursor-pointer hover:bg-row-hover [&:last-child>td]:border-b-0 ${fresh.has(t.id) ? "animate-arrive" : ""}`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a")) return;
                  navigate(`/tickets/${t.id}`);
                }}
              >
                <td className={`${td} whitespace-nowrap text-ink-3 tabular-nums`}>#{t.id}</td>
                <td className={td}>
                  <a className="font-semibold text-ink no-underline hover:text-link hover:underline" {...linkProps(`/tickets/${t.id}`)}>
                    {t.subject}
                  </a>
                </td>
                <td className={td}>{t.requester.name}</td>
                <td className={td}>
                  <StatusBadge status={t.status} />
                </td>
                <td className={td}>
                  <PriorityText priority={t.priority} />
                </td>
                <td className={td}>
                  <Assignee name={t.assignee} escalated={t.escalated_by_ai} />
                </td>
                <td className={`${td} whitespace-nowrap text-ink-3 tabular-nums`}>{stamp(t.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && tickets.length === 0 && (
          <div className="grid gap-1 px-4 py-8 text-center">
            <p className="font-semibold">{q ? "No tickets match that search" : "No tickets in this view"}</p>
            <p className="text-ink-3">
              {q ? "Try a ticket number like 2041 or a customer's first name." : "New tickets from chat show up here within 2 seconds."}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

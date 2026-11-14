import { navigate, match, useArrivals, useLocation, usePoll } from "@ph/shared/react";
import type { TicketSummary, TicketView } from "@ph/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Toasts } from "./components/Toasts.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Topbar } from "./components/Topbar.tsx";
import { TicketList } from "./components/TicketList.tsx";
import { TicketDetail } from "./components/TicketDetail.tsx";
import type { ListResponse } from "./views.ts";

export function App() {
  const { path, query } = useLocation();

  useEffect(() => {
    if (path === "/") navigate("/tickets?view=all_unsolved", { replace: true });
  }, [path]);

  const ticket = match("/tickets/:id", path);
  const view = (query.get("view") as TicketView | null) ?? "all_unsolved";
  // The list feeds the sidebar counts too, so it keeps polling on the detail page.
  const list = usePoll<ListResponse>(`/zendesk/tickets?view=${view}`);

  // Announce tickets the agent creates, unless the open list already shows them.
  const recent = list.data?.recent;
  const recentIds = useMemo(() => recent?.map((t) => t.id), [recent]);
  const arrived = useArrivals(recentIds);
  const [toasts, setToasts] = useState<TicketSummary[]>([]);
  useEffect(() => {
    if (!recent || !arrived.size) return;
    const visible = !ticket && list.data?.view === view ? new Set(list.data.tickets.map((t) => t.id)) : new Set<number>();
    const add = recent.filter((t) => arrived.has(t.id) && !visible.has(t.id) && Number(ticket?.id) !== t.id);
    if (add.length) setToasts((ts) => [...add.filter((a) => !ts.some((x) => x.id === a.id)), ...ts].slice(0, 3));
    // fire once per arrival batch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
      <Sidebar active={ticket ? null : view} counts={list.data?.counts} />
      <div className="flex min-w-0 flex-col md:h-dvh">
        <Topbar />
        {ticket ? <TicketDetail id={Number(ticket.id)} /> : <TicketList view={view} list={list} />}
      </div>
      <Toasts items={toasts} onDismiss={dismiss} />
    </div>
  );
}

import { match, navigate, useArrivals, useLocation, usePoll } from "@ph/shared/react";
import type { DealCard } from "@ph/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Toasts } from "./components/Toasts.tsx";
import { Topbar } from "./components/Topbar.tsx";
import { Board, type DealsResponse } from "./components/Board.tsx";
import { DealPage } from "./components/DealPage.tsx";
import { Contacts } from "./components/Contacts.tsx";
import { ContactPage } from "./components/ContactPage.tsx";

export function App() {
  const { path } = useLocation();

  useEffect(() => {
    if (path === "/") navigate("/deals", { replace: true });
  }, [path]);

  const deal = match("/deals/:id", path);
  const contact = match("/contacts/:id", path);
  const tab = path.startsWith("/contacts") ? "contacts" : "deals";
  const onBoard = tab === "deals" && !deal;

  // One deals poll for the whole app: it drives the board and the "new deal" toasts elsewhere.
  const deals = usePoll<DealsResponse>("/crm/deals");
  const ids = useMemo(() => deals.data?.deals.map((d) => d.id), [deals.data]);
  const arrived = useArrivals(ids);
  const [toasts, setToasts] = useState<DealCard[]>([]);
  useEffect(() => {
    if (!arrived.size || onBoard || !deals.data) return;
    const add = deals.data.deals.filter((d) => arrived.has(d.id));
    setToasts((ts) => [...add.filter((a) => !ts.some((x) => x.id === a.id)), ...ts].slice(0, 3));
    // fire once per arrival batch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  return (
    <>
      <Topbar tab={tab} />
      {deal ? (
        <DealPage id={Number(deal.id)} />
      ) : contact ? (
        <ContactPage id={Number(contact.id)} />
      ) : tab === "contacts" ? (
        <Contacts />
      ) : (
        <Board poll={deals} />
      )}
      <Toasts items={toasts} onDismiss={dismiss} />
    </>
  );
}

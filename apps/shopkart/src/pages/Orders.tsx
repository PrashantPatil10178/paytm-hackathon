import { rupees, type Customer, type Order, type OrderStatus, type PaymentStatus } from "@ph/shared";
import { linkProps, useChanged, usePoll } from "@ph/shared/react";
import { useRef } from "react";
import { Check, MessageCircleQuestion, PackageX } from "lucide-react";
import { useChat, useCustomer } from "../store.tsx";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const PAYMENT: Record<PaymentStatus, { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "bg-ok-wash text-ok" },
  cod: { label: "Cash on delivery", cls: "bg-wash-2 text-ink-2" },
  refunded: { label: "Refunded", cls: "bg-info-wash text-info" },
  refund_initiated: { label: "Refund started", cls: "bg-info-wash text-info" },
  failed_debited: { label: "Payment failed · amount debited", cls: "bg-bad-wash text-bad" },
};

const STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  placed: { label: "Placed", cls: "bg-jamun-wash text-jamun" },
  shipped: { label: "Shipped", cls: "bg-warn-wash text-warn" },
  delivered: { label: "Delivered", cls: "bg-ok-wash text-ok" },
  damaged: { label: "Damaged", cls: "bg-bad-wash text-bad" },
};

export function Orders() {
  const { customer } = useCustomer();
  // Polls so a refund the agent starts in chat shows up here without a reload.
  const poll = usePoll<{ customer: Customer; orders: Order[] }>(customer ? `/shop/customers/${customer.id}/orders` : null);
  const orders = poll.data?.customer.id === customer?.id ? poll.data?.orders : undefined;
  // Orders the agent just changed (a refund started from chat) get a short marigold ring.
  const none = useRef(new Set<string | number>());
  const changed = useChanged(orders, (o) => o.id, (o) => `${o.status}/${o.payment_status}`, none, 8000);

  return (
    <div className="wrap max-w-[920px] pt-8 sm:pt-12">
      <h1 className="text-[clamp(1.75rem,3.6vw,2.5rem)] leading-tight font-extrabold">My Orders</h1>
      <p className="mt-1 text-ink-2">{orders ? `${orders.length} orders for ${customer?.name}` : "Loading your orders…"}</p>

      {poll.error && (
        <p className="mt-6 rounded-xl border border-bad/20 bg-bad-wash px-4 py-3 text-bad" role="alert">
          {poll.error}
        </p>
      )}

      {orders?.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-line p-10 text-center">
          <p className="font-display text-lg font-bold">No orders yet</p>
          <p className="mt-1 text-ink-2">Pick something from today's deals and it'll show up here.</p>
          <a {...linkProps("/")} className="btn-primary mt-5">Browse products</a>
        </div>
      )}

      <ol className="mt-8 grid gap-5">
        {orders?.map((o) => <OrderCard key={o.id} o={o} updated={changed.has(o.id)} />)}
      </ol>
    </div>
  );
}

function OrderCard({ o, updated }: { o: Order; updated: boolean }) {
  const { askAbout } = useChat();
  const pay = PAYMENT[o.payment_status];
  const status = STATUS[o.status];

  return (
    <li
      className={`overflow-hidden rounded-2xl border bg-paper transition-[box-shadow,border-color] duration-500 hover:shadow-[var(--shadow-lift)] ${
        updated ? "border-marigold shadow-[0_0_0_4px_rgb(255_178_36/0.35)]" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-wash px-5 py-3 text-sm">
        <span>
          <span className="text-ink-3">Order </span>
          <span className="font-display text-base font-bold">#{o.id}</span>
        </span>
        <span className="text-ink-2">{dateFmt.format(new Date(o.placed_at))}</span>
        <span className="font-semibold tabular-nums">{rupees(o.amount)}</span>
        {updated && (
          <span className="animate-pop-in text-xs font-bold text-marigold-ink" role="status">
            Updated just now
          </span>
        )}
        <span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-bold ${status.cls}`}>{status.label}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${pay.cls}`}>{pay.label}</span>
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)] md:items-center">
        <ul className="grid gap-3">
          {o.items.map((i) => (
            <li key={i.product_id} className="flex items-center gap-3">
              <img src={i.image} alt="" className="size-14 flex-none rounded-xl bg-wash object-cover" />
              <div className="min-w-0">
                <p className="font-semibold">{i.name}</p>
                <p className="text-sm text-ink-2 tabular-nums">
                  {i.qty} × {rupees(i.price)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <TrackRail status={o.status} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        <p className="text-sm text-ink-2">
          {o.payment_status === "failed_debited"
            ? "Money left your bank but we never received it. We can sort this out in chat."
            : o.payment_status === "refund_initiated"
              ? `${rupees(o.amount)} is on its way back to you. Allow 3–5 working days.`
              : o.status === "damaged"
                ? "This order arrived damaged."
                : " "}
        </p>
        <button type="button" className="btn-quiet h-10" onClick={() => askAbout(o.id)}>
          <MessageCircleQuestion size={18} aria-hidden /> Need help?
        </button>
      </div>
    </li>
  );
}

/** Signature: the parcel's journey as a rail. A damaged delivery breaks the last stop in red. */
function TrackRail({ status }: { status: OrderStatus }) {
  const reached = { placed: 1, shipped: 2, delivered: 3, damaged: 3 }[status];
  const steps = ["Placed", "Shipped", status === "damaged" ? "Damaged" : "Delivered"];
  return (
    <ol className="grid grid-cols-3" aria-label={`Order progress: ${STATUS[status].label}`}>
      {steps.map((label, i) => {
        const done = i < reached;
        const broken = status === "damaged" && i === 2;
        return (
          <li key={label} className="relative flex flex-col items-center gap-1.5 text-center">
            {i > 0 && (
              <span
                className={`absolute top-3.5 right-1/2 h-0.5 w-full -translate-y-1/2 ${done ? (broken ? "bg-bad" : "bg-jamun") : "bg-line"}`}
                aria-hidden
              />
            )}
            <span
              className={`relative z-10 grid size-7 place-items-center rounded-full border-2 ${
                broken ? "border-bad bg-bad text-white" : done ? "border-jamun bg-jamun text-white" : "border-line bg-paper text-transparent"
              }`}
              aria-hidden
            >
              {broken ? <PackageX size={14} /> : <Check size={14} strokeWidth={3} />}
            </span>
            <span className={`text-xs font-semibold ${broken ? "text-bad" : done ? "text-ink" : "text-ink-3"}`}>
              {label}
              <span className="sr-only">{done ? " (done)" : " (not yet)"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

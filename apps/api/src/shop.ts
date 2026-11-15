import type { Order } from "@ph/shared";
import { db } from "./db.ts";
import { bad, handle, intParam, notFound, now, ok } from "./http.ts";

export function findCustomer(id: number) {
  const c = db.customers.find((x) => x.id === id);
  if (!c) throw notFound(`Customer ${id}`);
  return c;
}

export function findOrder(id: number): Order {
  const o = db.orders.find((x) => x.id === id);
  if (!o) throw notFound(`Order #${id}`);
  return o;
}

/** Starts a refund to the original payment method. Delivered orders are marked damaged (the only refund reason in the demo). */
export function refundOrder(id: number): Order {
  const o = findOrder(id);
  if (o.status !== "delivered" && o.status !== "damaged") throw bad(`Order #${id} is ${o.status}, so it can't be refunded yet`);
  if (o.payment_status === "refund_initiated" || o.payment_status === "refunded") throw bad(`Order #${id} already has a refund`);
  if (o.payment_status === "failed_debited") throw bad(`Order #${id} has a failed payment; that needs a manual reconcile, not a refund`);
  o.status = "damaged";
  o.payment_status = "refund_initiated";
  o.updated_at = now();
  return o;
}

export const shopRoutes = {
  "/shop/products": {
    GET: handle(() => ok({ products: db.products })),
  },
  "/shop/customers": {
    GET: handle(() => ok({ customers: db.customers })),
  },
  "/shop/customers/:id/orders": {
    GET: handle((req) => {
      const customer = findCustomer(intParam(req.params.id, "Customer id"));
      const orders = db.orders.filter((o) => o.customer_id === customer.id).sort((a, b) => b.placed_at.localeCompare(a.placed_at));
      return ok({ customer, orders });
    }),
  },
  "/shop/orders/:id": {
    GET: handle((req) => ok(findOrder(intParam(req.params.id, "Order id")))),
  },
  "/shop/orders/:id/refund": {
    POST: handle((req) => ok(refundOrder(intParam(req.params.id, "Order id")))),
  },
};

import type { Customer, Order } from "@ph/shared";
import { asc, desc, eq, schema as s, toCustomer, toOrder, toProduct } from "@ph/db";
import { db } from "./db.ts";
import { bad, handle, intParam, notFound, ok } from "./http.ts";

export async function findCustomer(id: number): Promise<Customer> {
  const [c] = await db.select().from(s.customers).where(eq(s.customers.id, id));
  if (!c) throw notFound(`Customer ${id}`);
  return toCustomer(c);
}

export async function findOrder(id: number): Promise<Order> {
  const [o] = await db.select().from(s.orders).where(eq(s.orders.id, id));
  if (!o) throw notFound(`Order #${id}`);
  return toOrder(o);
}

/** A customer's orders, newest first. */
export async function customerOrders(customerId: number): Promise<Order[]> {
  const rows = await db.select().from(s.orders).where(eq(s.orders.customer_id, customerId)).orderBy(desc(s.orders.placed_at));
  return rows.map(toOrder);
}

/** Starts a refund to the original payment method. Delivered orders are marked damaged (the only refund reason in the demo). */
export async function refundOrder(id: number): Promise<Order> {
  const o = await findOrder(id);
  if (o.status !== "delivered" && o.status !== "damaged") throw bad(`Order #${id} is ${o.status}, so it can't be refunded yet`);
  if (o.payment_status === "refund_initiated" || o.payment_status === "refunded") throw bad(`Order #${id} already has a refund`);
  if (o.payment_status === "failed_debited") throw bad(`Order #${id} has a failed payment; that needs a manual reconcile, not a refund`);
  const [row] = await db
    .update(s.orders)
    .set({ status: "damaged", payment_status: "refund_initiated", updated_at: new Date() })
    .where(eq(s.orders.id, id))
    .returning();
  return toOrder(row!);
}

export const shopRoutes = {
  "/shop/products": {
    GET: handle(async () => ok({ products: (await db.select().from(s.products).orderBy(asc(s.products.id))).map(toProduct) })),
  },
  "/shop/customers": {
    GET: handle(async () => ok({ customers: (await db.select().from(s.customers).orderBy(asc(s.customers.id))).map(toCustomer) })),
  },
  "/shop/customers/:id/orders": {
    GET: handle(async (req) => {
      const id = intParam(req.params.id, "Customer id");
      const [customer, orders] = await Promise.all([findCustomer(id), customerOrders(id)]);
      return ok({ customer, orders });
    }),
  },
  "/shop/orders/:id": {
    GET: handle(async (req) => ok(await findOrder(intParam(req.params.id, "Order id")))),
  },
  "/shop/orders/:id/refund": {
    POST: handle(async (req) => ok(await refundOrder(intParam(req.params.id, "Order id")))),
  },
};

import { db } from "./db.ts";
import { handle, intParam, notFound, ok } from "./http.ts";

export function findCustomer(id: number) {
  const c = db.customers.find((x) => x.id === id);
  if (!c) throw notFound(`Customer ${id}`);
  return c;
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
    GET: handle((req) => {
      const id = intParam(req.params.id, "Order id");
      const order = db.orders.find((o) => o.id === id);
      if (!order) throw notFound(`Order #${id}`);
      return ok(order);
    }),
  },
};

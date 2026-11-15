/** Tools for the support agent. Each one acts on the chat's own ticket and customer only. */
import { rupees, SUPPORT_AGENTS, type Order } from "@ph/shared";
import { createTool } from "@voltagent/core";
import { z } from "zod";
import type { DemoAPI } from "../demo-api.ts";
import { runOf, type SupportRun } from "./context.ts";

/** Refunds up to this amount go through without a person. Enforced here, not just in the prompt. */
export const AUTO_REFUND_LIMIT = 1000;

const orderView = (o: Order) => ({
  id: o.id,
  status: o.status,
  payment_status: o.payment_status,
  amount: o.amount,
  amount_text: rupees(o.amount),
  items: o.items.map((i) => `${i.qty} × ${i.name}`),
  placed_at: o.placed_at,
  updated_at: o.updated_at,
});

export function supportTools(api: DemoAPI) {
  async function ownOrder(run: SupportRun, orderId: number) {
    const order = await api.order(orderId);
    if (order.customer_id !== run.customerId) throw new Error(`Order #${orderId} belongs to a different customer`);
    return order;
  }

  const getCustomerOrders = createTool({
    name: "get_customer_orders",
    description: "List this customer's orders, newest first, with status, payment status and items.",
    parameters: z.object({}),
    execute: async (_args, opts) => {
      const { customer, orders } = await api.customerOrders(runOf<SupportRun>(opts).customerId);
      return { customer: { id: customer.id, name: customer.name }, orders: orders.map(orderView) };
    },
  });

  const getOrder = createTool({
    name: "get_order",
    description: "Look up one of this customer's orders by its number (e.g. 1023).",
    parameters: z.object({ order_id: z.number().int().describe("Order number without the #") }),
    execute: async ({ order_id }, opts) => orderView(await ownOrder(runOf(opts), order_id)),
  });

  const updateTicket = createTool({
    name: "update_ticket",
    description:
      "Set fields on this chat's Zendesk ticket. Give it a short subject a support lead can scan, " +
      "a type and priority, tags, and status (solved when fully resolved, pending when waiting on the customer).",
    parameters: z.object({
      subject: z.string().min(3).max(90).optional(),
      type: z.enum(["question", "incident", "problem"]).optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      status: z.enum(["open", "pending", "solved"]).optional(),
      tags: z.array(z.string()).max(6).optional().describe("Replaces the tags. Keep 'chat'. E.g. refund, wismo, payment"),
    }),
    execute: async (changes, opts) => {
      const t = await api.updateTicket(runOf<SupportRun>(opts).ticketId, changes);
      return { ticket_id: t.id, subject: t.subject, status: t.status, priority: t.priority, type: t.type, tags: t.tags };
    },
  });

  const addInternalNote = createTool({
    name: "add_internal_note",
    description: "Add an internal note to the ticket (team only, the customer never sees it). Use it to record what you checked and why you acted.",
    parameters: z.object({ body: z.string().min(1) }),
    execute: async ({ body }, opts) => {
      await api.addComment(runOf<SupportRun>(opts).ticketId, { body, public: false });
      return { ok: true };
    },
  });

  const startRefund = createTool({
    name: "start_refund",
    description:
      `Refund a delivered or damaged order to the original payment method. Only works up to ${rupees(AUTO_REFUND_LIMIT)}; ` +
      "above that it refuses and you must escalate_to_human instead. Logs an internal note itself.",
    parameters: z.object({
      order_id: z.number().int(),
      reason: z.string().min(3).describe("What the customer reported, e.g. 'mugs arrived broken'"),
    }),
    execute: async ({ order_id, reason }, opts) => {
      const run = runOf<SupportRun>(opts);
      const order = await ownOrder(run, order_id);
      if (order.amount > AUTO_REFUND_LIMIT) {
        return { ok: false, needs_human: true, why: `${rupees(order.amount)} is above the ${rupees(AUTO_REFUND_LIMIT)} auto-refund limit` };
      }
      const refunded = await api.refundOrder(order_id); // the API rejects orders that aren't refundable
      await api.addComment(run.ticketId, {
        public: false,
        body: `Refund of ${rupees(order.amount)} started for order #${order_id} (under the ${rupees(AUTO_REFUND_LIMIT)} auto-refund limit). Customer reported: ${reason}.`,
      });
      return { ok: true, order: orderView(refunded), arrives: "3–5 working days" };
    },
  });

  const escalateToHuman = createTool({
    name: "escalate_to_human",
    description:
      "Hand the ticket to a person. Use for failed payments where money was debited, refunds above the limit, " +
      "angry or unclear cases, or anything you can't resolve. The note must give them everything they need.",
    parameters: z.object({
      assignee: z.enum(SUPPORT_AGENTS).describe("Priya handles payments and refunds; Karan handles delivery and everything else"),
      priority: z.enum(["normal", "high", "urgent"]),
      note: z.string().min(10).describe("Internal hand-off note: what happened, what you checked, what they should do"),
    }),
    execute: async ({ assignee, priority, note }, opts) => {
      const { ticketId } = runOf<SupportRun>(opts);
      await api.addComment(ticketId, { body: note, public: false });
      // Moving it off the bot marks the ticket "Escalated by AI" in Zendesk.
      const t = await api.updateTicket(ticketId, { assignee, priority, status: "open" });
      return { ok: true, assignee: t.assignee, escalated_by_ai: t.escalated_by_ai };
    },
  });

  return [getCustomerOrders, getOrder, updateTicket, addInternalNote, startRefund, escalateToHuman];
}

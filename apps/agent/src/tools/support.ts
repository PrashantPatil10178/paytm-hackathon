/**
 * Tools for the three level agents. Each acts on the request's own ticket and customer only (read
 * from the run context, never from model arguments) and records itself as a step on the run.
 *
 * Which agent gets which tools is the point of the levels:
 *   low    → look up, search past cases, update and close the ticket
 *   low, answering in the chat without a ticket ("direct") → look up, search past cases, escalate_to_human
 *            (which opens the ticket then, through the run context)
 *   medium → plus start_refund (refuses above the auto-refund limit, a Control Room setting) and escalate_to_human
 *   high   → look up, request_approval for the refund, escalate_to_human. No direct refunds.
 * start_refund and request_approval only take an order the customer named (run.orderIds, set in code).
 */
import { rupees, SUPPORT_AGENTS, type CreateStepBody, type Order } from "@ph/shared";
import { createTool, type ToolExecuteOptions } from "@voltagent/core";
import { z } from "zod";
import { AUTO_REFUND_LIMIT } from "../criticality.ts";
import type { DemoAPI } from "../demo-api.ts";
import type { Platform } from "../platform.ts";
import { runOf, ticketOf, type SupportRun } from "./context.ts";

export { AUTO_REFUND_LIMIT };

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

export type Level = SupportRun["agent"];

/** The customer didn't say which order: a refund or approval must not pick one for them. */
const unnamed = (orderId: number) => ({
  ok: false,
  needs_customer: true,
  why: `The customer hasn't said that order #${orderId} is the one. Ask them which order or item it is before refunding anything.`,
});

export function supportTools(api: DemoAPI, platform: Platform | undefined, level: Level, { direct = false }: { direct?: boolean } = {}) {
  /** The live auto-refund limit (Control Room settings, cached by the platform client); the default without one. */
  const refundLimit = () => (platform ? platform.refundLimit() : Promise.resolve(AUTO_REFUND_LIMIT));

  /** Records a step on the run. Never lets a logging problem break the customer's request. */
  async function step(opts: ToolExecuteOptions | undefined, s: Omit<CreateStepBody, "agent">) {
    if (!platform) return;
    const run = runOf<SupportRun>(opts);
    await platform.addStep(run.runId, { agent: run.agent, ...s }).catch(() => {});
  }

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
      await step(opts, { step: "Look up orders", tool: "ShopKart", result: "success", detail: `${orders.length} orders found` });
      return { customer: { id: customer.id, name: customer.name }, orders: orders.map(orderView) };
    },
  });

  const getOrder = createTool({
    name: "get_order",
    description: "Look up one of this customer's orders by its number (e.g. 1023).",
    parameters: z.object({ order_id: z.number().int().describe("Order number without the #") }),
    execute: async ({ order_id }, opts) => {
      const o = await ownOrder(runOf(opts), order_id);
      await step(opts, { step: "Check order", tool: "ShopKart", result: "success", detail: `#${o.id}: ${o.status}, ${o.payment_status}, ${rupees(o.amount)}` });
      return orderView(o);
    },
  });

  const searchPastCases = createTool({
    name: "search_past_cases",
    description: "Search ResolveAI's memory of solved cases for similar problems and how they were fixed. Use it before deciding when unsure.",
    parameters: z.object({ query: z.string().min(3).describe("The problem in a few words, e.g. 'mugs arrived broken refund'") }),
    execute: async ({ query }, opts) => {
      const cases = platform ? await platform.searchCases(query).catch(() => []) : [];
      await step(opts, { step: "Search past cases", tool: "Memory", result: "success", detail: `${cases.length} similar case${cases.length === 1 ? "" : "s"} for "${query}"` });
      return { cases: cases.map((c) => ({ problem: c.problem, resolution: c.resolution, outcome: c.outcome, level: c.level })) };
    },
  });

  const updateTicket = createTool({
    name: "update_ticket",
    description: "Set the ticket's status: solved when fully resolved, pending when waiting on the customer.",
    parameters: z.object({
      status: z.enum(["open", "pending", "solved"]),
      tags: z.array(z.string()).max(4).optional().describe("Extra tags to add, e.g. wismo, refund"),
    }),
    execute: async ({ status, tags }, opts) => {
      const run = runOf<SupportRun>(opts);
      const ticketId = await ticketOf(run);
      // A refund waiting for a person's approval keeps its ticket open until they decide.
      if (status === "solved" && platform && (await platform.pendingApprovalFor(ticketId).catch(() => undefined))) {
        return { ok: false, why: "A refund on this ticket is waiting for approval; leave the ticket as it is." };
      }
      const current = tags?.length ? await api.ticket(ticketId) : null;
      const t = await api.updateTicket(ticketId, { status, ...(current && { tags: [...new Set([...current.tags, ...tags!])] }) });
      await step(opts, { step: status === "solved" ? "Close ticket" : "Update ticket", tool: "Zendesk", result: "success", detail: `#${t.id} is ${t.status}` });
      return { ticket_id: t.id, status: t.status, tags: t.tags };
    },
  });

  const addInternalNote = createTool({
    name: "add_internal_note",
    description: "Add an internal note to the ticket (team only, the customer never sees it). Record what you checked and why you acted.",
    parameters: z.object({ body: z.string().min(1) }),
    execute: async ({ body }, opts) => {
      await api.addComment(await ticketOf(runOf<SupportRun>(opts)), { body, public: false });
      await step(opts, { step: "Internal note", tool: "Zendesk", result: "success", detail: body.slice(0, 160) });
      return { ok: true };
    },
  });

  const startRefund = createTool({
    name: "start_refund",
    description:
      "Refund a delivered or damaged order to the original payment method. Only works up to the auto-refund limit " +
      "given with the ticket; above that it refuses and you must escalate_to_human instead. Logs an internal note itself.",
    parameters: z.object({
      order_id: z.number().int(),
      reason: z.string().min(3).describe("What the customer reported, e.g. 'mugs arrived broken'"),
    }),
    execute: async ({ order_id, reason }, opts) => {
      const run = runOf<SupportRun>(opts);
      const [order, limit] = await Promise.all([ownOrder(run, order_id), refundLimit()]);
      if (!run.orderIds.includes(order_id)) {
        await step(opts, { step: "Refund", tool: "Paytm", result: "blocked", detail: `#${order_id} wasn't named by the customer: ask which order first` });
        return unnamed(order_id);
      }
      if (order.amount > limit) {
        await step(opts, { step: "Refund", tool: "Paytm", result: "blocked", detail: `${rupees(order.amount)} is above the ${rupees(limit)} limit` });
        return { ok: false, needs_human: true, why: `${rupees(order.amount)} is above the ${rupees(limit)} auto-refund limit` };
      }
      const refunded = await api.refundOrder(order_id); // the API rejects orders that aren't refundable
      await api.addComment(await ticketOf(run), {
        public: false,
        body: `Refund of ${rupees(order.amount)} started for order #${order_id} (within the ${rupees(limit)} auto-refund limit). Customer reported: ${reason}.`,
      });
      await step(opts, { step: "Refund", tool: "Paytm", result: "success", detail: `${rupees(order.amount)} refunded for #${order_id}` });
      return { ok: true, order: orderView(refunded), arrives: "3–5 working days" };
    },
  });

  const requestApproval = createTool({
    name: "request_approval",
    description:
      "Ask a person to approve a refund you can't do alone. Writes your plan to the Approvals queue and an internal note; " +
      "the ticket waits until someone approves or rejects it. Then tell the customer a teammate will confirm shortly.",
    parameters: z.object({
      order_id: z.number().int(),
      reason: z.string().min(3).describe("What the customer reported"),
      summary: z.string().min(10).describe("What happened and what you checked, for the approver"),
      suggestion: z.string().min(10).describe("The exact action you propose, e.g. 'Refund ₹4,250 to the original payment method'"),
    }),
    execute: async ({ order_id, reason, summary, suggestion }, opts) => {
      const run = runOf<SupportRun>(opts);
      if (!platform) return { ok: false, why: "approvals are not available" };
      const order = await ownOrder(run, order_id);
      if (!run.orderIds.includes(order_id)) {
        await step(opts, { step: "Request approval", tool: "Approvals", result: "blocked", detail: `#${order_id} wasn't named by the customer: ask which order first` });
        return unnamed(order_id);
      }
      if (order.payment_status === "refund_initiated" || order.payment_status === "refunded") return { ok: false, why: `order #${order_id} already has a refund` };
      // One approval per order: a second chat or ticket about the same order joins the one already waiting.
      const sameOrder = await platform.pendingApprovalForOrder(order_id);
      if (sameOrder) {
        await step(opts, { step: "Request approval", tool: "Approvals", result: "escalated", detail: `#${sameOrder.id} for order #${order_id} is already waiting (ticket #${sameOrder.ticket_id})` });
        return { ok: true, approval_id: sameOrder.id, already_pending: true, on_ticket: sameOrder.ticket_id };
      }
      const ticketId = await ticketOf(run);
      const existing = await platform.pendingApprovalFor(ticketId);
      if (existing) return { ok: true, approval_id: existing.id, already_pending: true };
      const approval = await platform.createApproval({ run_id: run.runId, ticket_id: ticketId, action: "refund", order_id, amount: order.amount, reason, summary, suggestion });
      await api.addComment(ticketId, { public: false, body: `Approval requested (#${approval.id}): ${suggestion}\n${summary}` });
      await api.updateTicket(ticketId, { status: "pending" });
      await platform.updateRun(run.runId, { status: "waiting_approval" });
      await step(opts, { step: "Request approval", tool: "Approvals", result: "escalated", detail: `#${approval.id}: ${suggestion}` });
      return { ok: true, approval_id: approval.id };
    },
  });

  const escalateToHuman = createTool({
    name: "escalate_to_human",
    description:
      "Hand the ticket to a person. Use for anything you can't resolve or the customer is upset about. The note must give them everything they need.",
    parameters: z.object({
      assignee: z.enum(SUPPORT_AGENTS).describe("The business owner, who handles everything a person must look at"),
      priority: z.enum(["normal", "high", "urgent"]),
      note: z.string().min(10).describe("Internal hand-off note: what happened, what you checked, what they should do"),
    }),
    execute: async ({ assignee, priority, note }, opts) => {
      const run = runOf<SupportRun>(opts);
      const ticketId = await ticketOf(run); // a ticketless chat gets its ticket now, with the conversation so far
      await api.addComment(ticketId, { body: note, public: false });
      // Moving it off the bot marks the ticket "Escalated by AI" in Zendesk.
      const t = await api.updateTicket(ticketId, { assignee, priority, status: "open", handled_by: "human" });
      await step(opts, { step: "Escalate to human", tool: "Zendesk", result: "escalated", detail: `#${ticketId} assigned to ${assignee}` });
      return { ok: true, ticket_id: ticketId, assignee: t.assignee, escalated_by_ai: t.escalated_by_ai };
    },
  });

  // Answering in the chat without a ticket: nothing to update or note on; handing over opens the ticket.
  if (direct) return [getCustomerOrders, getOrder, searchPastCases, escalateToHuman];
  const read = [getCustomerOrders, getOrder, searchPastCases, addInternalNote];
  if (level === "low") return [...read, updateTicket, escalateToHuman];
  if (level === "medium") return [...read, updateTicket, startRefund, escalateToHuman];
  return [...read, requestApproval, escalateToHuman];
}

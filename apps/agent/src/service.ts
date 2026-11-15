/**
 * POST /chat and POST /lead. The parts that must always happen are plain code (one ticket per chat
 * session, a contact + deal per enquiry, the reply posted on the ticket); the decisions in between
 * are made by the VoltAgent agents through their tools. If the model fails, the customer still gets
 * an answer and the ticket or deal is left for a person.
 */
import { BOT, ENQUIRY_NEEDS, rupees, type ChatResponse, type LeadResponse } from "@ph/shared";
import type { Agent } from "@voltagent/core";
import { z } from "zod";
import { DemoAPIError, type DemoAPI } from "./demo-api.ts";
import { runContext } from "./tools/context.ts";

const ChatBody = z.object({
  session_id: z.string().min(1),
  customer_id: z.coerce.number().int().positive(),
  message: z.string().trim().min(1),
});

const LeadBody = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  email: z.email(),
  business_name: z.string().trim().min(1),
  need: z.enum(ENQUIRY_NEEDS.map((n) => n.id) as [string, ...string[]]),
  budget: z.coerce.number().min(0).default(0),
  start_when: z.string().default(""),
});

export type Result<T> = { status: number; body: T | { error: string } };

const today = () => new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export interface ServiceDeps {
  api: DemoAPI;
  support: Agent;
  sales: Agent;
  log?: Pick<Console, "warn" | "error">;
}

export function createService({ api, support, sales, log = console }: ServiceDeps) {
  /** session_id → ticket id. In memory, like the agents' conversation memory. */
  const sessions = new Map<string, number>();

  async function ticketFor(sessionId: string, customerId: number, message: string): Promise<{ id: number; customer: string; isNew: boolean }> {
    const known = sessions.get(sessionId);
    if (known) {
      try {
        const t = await api.ticket(known);
        await api.addComment(t.id, { body: message, public: true, author: t.requester.name, author_type: "customer" });
        if (t.status === "solved") await api.updateTicket(t.id, { status: "open" });
        return { id: t.id, customer: t.requester.name, isNew: false };
      } catch (e) {
        if (!(e instanceof DemoAPIError && e.status === 404)) throw e; // demo data was reset: open a new ticket
      }
    }
    const t = await api.createTicket({
      subject: message.length > 60 ? `${message.slice(0, 57)}…` : message,
      comment: message,
      requester_id: customerId,
      via: "chat",
      status: "open",
      assignee: BOT,
      tags: ["chat"],
    });
    sessions.set(sessionId, t.id);
    return { id: t.id, customer: t.requester.name, isNew: true };
  }

  async function chat(raw: unknown): Promise<Result<ChatResponse>> {
    const parsed = ChatBody.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error);
    const { session_id, customer_id, message } = parsed.data;

    return guard(async () => {
      const ticket = await ticketFor(session_id, customer_id, message);
      const prompt = `[Zendesk ticket #${ticket.id}${ticket.isNew ? " (new)" : ""} · customer ${ticket.customer} (id ${customer_id}) · today ${today()}]\n${message}`;

      let reply: string;
      try {
        const res = await support.generateText(prompt, {
          userId: `customer-${customer_id}`,
          conversationId: session_id,
          context: runContext({ ticketId: ticket.id, customerId: customer_id }),
        });
        reply = res.text.trim();
        if (!reply) throw new Error("the model returned an empty reply");
      } catch (e) {
        log.error(`[agent] support agent failed on ticket #${ticket.id}:`, e);
        await api.addComment(ticket.id, { public: false, body: `Aria couldn't handle this message (${errorText(e)}). Needs a person.` });
        await api.updateTicket(ticket.id, { assignee: null, status: "open" });
        reply = `Thanks for reaching out. I've logged this as ticket #${ticket.id} and a teammate will get back to you shortly.`;
      }

      await api.addComment(ticket.id, { body: reply, public: true });
      return { status: 200, body: { reply, ticket_id: ticket.id } };
    });
  }

  async function lead(raw: unknown): Promise<Result<LeadResponse>> {
    const parsed = LeadBody.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error);
    const b = parsed.data;
    const need = ENQUIRY_NEEDS.find((n) => n.id === b.need)!.label;

    return guard(async () => {
      const contact = await api.createContact({ name: b.name, email: b.email, phone: b.phone, company: b.business_name, source: "Business enquiry form" });
      const deal = await api.createDeal({ name: `${b.business_name} – ${need}`, amount: b.budget, contact_id: contact.id });
      const prompt = [
        `New business enquiry · deal #${deal.id} · today ${today()}`,
        `Name: ${b.name}`,
        `Business: ${b.business_name}`,
        `Need: ${need}`,
        `Budget: ${rupees(b.budget)}`,
        `Wants to start: ${b.start_when || "not given"}`,
      ].join("\n");

      let message = "Thanks! Our team will contact you shortly.";
      try {
        const res = await sales.generateText(prompt, {
          userId: `contact-${contact.id}`,
          conversationId: `lead-${deal.id}`,
          context: runContext({ dealId: deal.id, contactId: contact.id }),
        });
        message = res.text.trim() || message;
      } catch (e) {
        log.error(`[agent] sales agent failed on deal #${deal.id}:`, e);
        await api.addDealNote(deal.id, {
          type: "note",
          body: `New lead from the business enquiry form. Budget ${rupees(b.budget)}, wants to start: ${b.start_when || "not given"}. Aria couldn't score it (${errorText(e)}); needs a person.`,
        });
      }
      return { status: 201, body: { ok: true, message, deal_id: deal.id } };
    });
  }

  async function guard<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DemoAPIError) {
        log.warn(`[agent] demo API: ${e.message}`);
        return { status: 502, body: { error: `Demo API said: ${e.message}` } };
      }
      throw e;
    }
  }

  return { chat, lead };
}

function invalid(error: z.ZodError): Result<never> {
  return { status: 400, body: { error: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") } };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

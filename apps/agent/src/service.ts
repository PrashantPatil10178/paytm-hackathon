/**
 * The ResolveAI service: what happens to every request, start to finish.
 *
 *   POST /intake (a channel, with its token)
 *     → the main agent triages it: new request or status check, intent, signals, plan
 *     → code sets the level (criticality.ts) and opens or updates the Zendesk ticket
 *     → the main agent answers at once ("I'm on it, ticket #…") and the request returns
 *     → low / medium / high agent works it in the background, or a person for critical ones
 *     → the final reply goes onto the ticket (the ShopKart chat picks it up from there)
 *     → finished cases are saved to memory (rai_cases) for next time
 *   POST /approvals/:id/decided (from the demo API, after a person decides in the Control Room)
 *     → the approved refund is carried out, the customer is told, the case is saved
 *   POST /lead → the sales agent; POST /analysis → the analysis agent;
 *   POST /campaigns/sync → the leads agent over new campaign responses (a campaign response the
 *   agent couldn't decide stays new for the next run)
 *
 * Plain code does everything that must always happen (ticket, level, reply, audit steps, memory);
 * the agents make the decisions in between. If a model call fails the customer still gets an answer
 * and the ticket goes to a person.
 */
import {
  BOT,
  ENQUIRY_NEEDS,
  rupees,
  SUPPORT_AGENTS,
  type AnalysisResponse,
  type CampaignResponse,
  type CaseOutcome,
  type ChatResponse,
  type CreateStepBody,
  type LeadResponse,
  type LeadSyncResponse,
  type LeadSyncResult,
  type Order,
  type Ticket,
} from "@ph/shared";
import type { Agent, Memory } from "@voltagent/core";
import { Output } from "ai";
import { z } from "zod";
import type { LevelAgents } from "./agents/levels.ts";
import { TriageSchema, type Triage } from "./agents/main.ts";
import { assessCriticality, ORDER_INTENTS, type Criticality } from "./criticality.ts";
import { DemoAPIError, type DemoAPI, type KnownContact } from "./demo-api.ts";
import { analysisNote, analysisThread, personKey } from "./memory.ts";
import type { Platform } from "./platform.ts";
import { memorySessions, type SessionStore } from "./sessions.ts";
import { runContext, type AnalysisRun, type LeadsRun } from "./tools/context.ts";

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

const AnalysisBody = z.object({ focus: z.string().trim().max(300).optional(), scope: z.enum(["all", "sales"]).default("all") }).default({ scope: "all" });

const LeadSyncBody = z.object({ limit: z.coerce.number().int().min(1).max(25).default(10) }).default({ limit: 10 });

/** Campaign responses worked on at once: quicker than one by one, gentle on the model's rate limit. */
const LEAD_CONCURRENCY = 3;

export type Result<T> = { status: number; body: T | { error: string } };

const today = () => new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const LEVEL_LABEL = { low: "Low", medium: "Medium", high: "High", critical: "Critical" } as const;
const HANDLER_LABEL = { low: "low agent", medium: "medium agent", high: "high agent (approval needed)", human: "a person" } as const;
const DAY = 86_400_000;

export interface ServiceDeps {
  api: DemoAPI;
  platform: Platform;
  main: Agent;
  /** Writes short customer messages (status updates) from facts. */
  writer: Agent;
  levels: LevelAgents;
  sales: Agent;
  analysis: Agent;
  leads: Agent;
  /** Chat session → ticket. Postgres in the app, in memory in tests. */
  sessions?: SessionStore;
  /** The analysis agent's memory (with working memory), where the note about the last report is kept. */
  analysisMemory?: Memory;
  log?: Pick<Console, "warn" | "error">;
}

export function createService({ api, platform, main, writer, levels, sales, analysis, leads, sessions = memorySessions(), analysisMemory, log = console }: ServiceDeps) {
  /** Level agents that are still working after /intake answered. */
  const inFlight = new Set<Promise<unknown>>();
  const track = (job: Promise<unknown>) => {
    inFlight.add(job);
    void job.finally(() => inFlight.delete(job));
  };
  /** Resolves when every background job has finished (tests, graceful shutdown). */
  const settled = async () => {
    while (inFlight.size) await Promise.allSettled([...inFlight]);
  };

  /* ───── Tickets ───── */

  /** The ticket this chat session already has, if it still exists (a demo reset recycles ticket numbers). */
  async function knownTicket(sessionId: string): Promise<Ticket | null> {
    const known = await sessions.get(sessionId);
    if (!known) return null;
    try {
      const t = await api.ticket(known.ticketId);
      return t.created_at === known.ticketCreatedAt ? t : null;
    } catch (e) {
      if (e instanceof DemoAPIError && e.status === 404) return null;
      throw e;
    }
  }

  /** The customer's open ticket, else their newest one. For status checks from a new chat. */
  async function latestTicket(customerId: number): Promise<Ticket | null> {
    const list = await api.customerTickets(customerId).catch(() => []);
    const pick = list.find((t) => t.status !== "solved") ?? list[0];
    return pick ? api.ticket(pick.id) : null;
  }

  async function addCustomerMessage(t: Ticket, message: string) {
    await api.addComment(t.id, { body: message, public: true, author: t.requester.name, author_type: "customer" });
  }

  /** Reuses the session's ticket (adding the message, reopening it if solved) or opens a new one. */
  async function ticketFor(known: Ticket | null, sessionId: string, customerId: number, message: string): Promise<{ ticket: Ticket; isNew: boolean }> {
    if (known) {
      await addCustomerMessage(known, message);
      const ticket = known.status === "solved" ? await api.updateTicket(known.id, { status: "open" }) : known;
      return { ticket, isNew: false };
    }
    const ticket = await api.createTicket({
      subject: message.length > 60 ? `${message.slice(0, 57)}…` : message,
      comment: message,
      requester_id: customerId,
      via: "chat",
      status: "open",
      assignee: BOT,
      tags: ["chat"],
    });
    await sessions.set(sessionId, { ticketId: ticket.id, ticketCreatedAt: ticket.created_at });
    return { ticket, isNew: true };
  }

  /* ───── Runs, steps and memory ───── */

  const stepper = (runId: number) => (agent: CreateStepBody["agent"], s: Omit<CreateStepBody, "agent">) =>
    platform.addStep(runId, { agent, ...s }).catch((e) => log.warn(`[agent] couldn't record a step on run ${runId}:`, errorText(e)));

  /** The main agent's memory: a finished case, saved so similar requests are solved faster later. */
  async function remember(runId: number, c: { ticketId: number | null; customerId: number; intent: string; level: Criticality["level"]; handledBy: Criticality["handled_by"]; problem: string; resolution: string; outcome: CaseOutcome }) {
    try {
      const run = await platform.run(runId);
      const steps = (run.steps ?? []).filter((s) => s.agent !== "main" || s.step !== "Receive request").map((s) => `${s.step} (${s.tool}): ${s.detail}`);
      await platform.saveCase({
        run_id: runId,
        ticket_id: c.ticketId,
        customer_id: c.customerId,
        intent: c.intent,
        level: c.level,
        handled_by: c.handledBy,
        problem: c.problem,
        steps,
        resolution: c.resolution,
        outcome: c.outcome,
        tags: [c.intent, `level:${c.level}`, c.outcome],
      });
      await stepper(runId)("main", { step: "Save to memory", tool: "Memory", result: "success", detail: `Case saved as ${c.outcome}: ${c.problem}` });
    } catch (e) {
      log.warn(`[agent] couldn't save run ${runId} to memory:`, errorText(e));
    }
  }

  /* ───── Intake ───── */

  async function intake(token: string | undefined, raw: unknown): Promise<Result<ChatResponse>> {
    if (!token) return { status: 401, body: { error: "Send the channel token: Authorization: Bearer <token>" } };
    let channel;
    try {
      channel = await platform.authenticate(token);
    } catch (e) {
      if (!(e instanceof DemoAPIError)) throw e;
      if (e.status === 401 || e.status === 403) return { status: e.status, body: { error: e.message } };
      log.warn(`[agent] couldn't check the channel token: ${e.message}`);
      return { status: 502, body: { error: `Demo API said: ${e.message}` } };
    }
    const parsed = ChatBody.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error);
    const { session_id, customer_id, message } = parsed.data;

    return guard(async () => {
      const run = await platform.createRun({ channel_id: channel.id, session_id, customer_id, message });
      const step = stepper(run.id);
      await step("main", { step: "Receive request", tool: channel.name, result: "success", detail: message.slice(0, 160) });

      const [{ customer, orders }, known, cases] = await Promise.all([
        api.customerOrders(customer_id),
        knownTicket(session_id),
        platform.searchCases(message).catch(() => []),
      ]);

      /* 1. The main agent triages. */
      const prompt = [
        `Today: ${today()}. Customer: ${customer.name} (id ${customer_id}).`,
        `Their orders: ${JSON.stringify(orders.map(orderBrief))}`,
        known ? `Open ticket in this chat: #${known.id} "${known.subject}", status ${known.status}, assignee ${known.assignee ?? "nobody"}.` : "No ticket in this chat yet.",
        cases.length ? `Similar past cases: ${JSON.stringify(cases.map((c) => ({ problem: c.problem, resolution: c.resolution, level: c.level, outcome: c.outcome })))}` : "No similar past cases.",
        `Message: ${message}`,
      ].join("\n");
      let triage: Triage | null = null;
      try {
        const res = await main.generateText(prompt, { output: Output.object({ schema: TriageSchema }), userId: `customer-${customer_id}`, conversationId: `${session_id}:main` });
        triage = res.output as Triage;
      } catch (e) {
        log.error(`[agent] main agent couldn't triage run ${run.id}:`, e);
      }
      if (!triage) return handOver(run.id, known, session_id, customer_id, message, "the main agent couldn't read the request");
      await step("main", { step: "Triage", tool: "Aria LLM", result: "success", detail: `${triage.kind === "status_check" ? "status check" : "new request"}, ${triage.intent}, confidence ${Math.round(triage.confidence * 100)}%: ${triage.summary}` });

      /* 2. Out of scope: a polite answer, no ticket and no one pulled in. */
      if (triage.intent === "out_of_scope") return outOfScope(run.id, known, message, triage);

      /* 3. A status check: answer from the ticket, don't open a new one. No earlier request to report on → the team. */
      if (triage.kind === "status_check") {
        const ticket = known ?? (await latestTicket(customer_id));
        if (ticket) return statusUpdate(run.id, ticket, message, triage, !known);
        return toTeam(run.id, null, session_id, customer_id, message, triage, "asked for an update, but we have no earlier request from this customer");
      }

      /* 4. About an order, but the customer has no orders: nothing for an agent to work with → the team. */
      if (ORDER_INTENTS.includes(triage.intent) && orders.length === 0) {
        return toTeam(run.id, known, session_id, customer_id, message, triage, "asked about an order, but there are no orders on this account");
      }

      /* 5. A new request: level, ticket, route. */
      // The order they named isn't on their account: no agent can work it, so the team checks with them.
      // Checked in code too ("order 9999", "order #9999"), in case the model left the number out.
      const named = triage.order_id ?? mentionedOrder(message);
      if (named && !orders.some((o) => o.id === named)) {
        return toTeam(run.id, known, session_id, customer_id, message, triage, `asked about order #${named}, which isn't on their account`);
      }
      const order = named ? orders.find((o) => o.id === named)! : null;
      const recent = (await api.customerTickets(customer_id).catch(() => [])).filter((t) => t.id !== known?.id && Date.now() - new Date(t.created_at).getTime() < 30 * DAY).length;
      const crit = assessCriticality({ intent: triage.intent, signals: triage.signals, confidence: triage.confidence, order, recentTickets: recent });
      await step("main", { step: "Set level", tool: "Criticality rules", result: "success", detail: `${LEVEL_LABEL[crit.level]}: ${crit.reasons.join("; ")}` });

      const { ticket, isNew } = await ticketFor(known, session_id, customer_id, message);

      // A person already owns this ticket: pass the message on, don't let the AI act over them.
      if (!isNew && ticket.assignee && ticket.assignee !== BOT) {
        const reply = `Thanks, I've added this to your ticket #${ticket.id}. ${ticket.assignee.split(" – ")[0]} from our team is on it and will reply here.`;
        await api.addComment(ticket.id, { body: reply, public: true });
        await platform.updateRun(run.id, { ticket_id: ticket.id, intent: triage.intent, plan: triage.plan, handled_by: "human", status: "escalated", reply });
        await step("main", { step: "Pass to owner", tool: "Zendesk", result: "escalated", detail: `#${ticket.id} is with ${ticket.assignee}` });
        return { status: 200, body: { reply, ticket_id: ticket.id } };
      }

      /** Writes the triage onto the run and the ticket (level, who handles it, priority, triage note). */
      const recordTriage = async () => {
        await platform.updateRun(run.id, {
          ticket_id: ticket.id,
          intent: triage!.intent,
          level: crit.level,
          level_reason: crit.reasons.join("; "),
          handled_by: crit.handled_by,
          plan: triage!.plan,
          status: "working",
        });
        await api.updateTicket(ticket.id, {
          ...(isNew && { subject: subjectFor(triage!, order) }),
          priority: crit.level,
          type: triage!.intent === "order_tracking" || triage!.intent === "question" ? "question" : "incident",
          tags: [...new Set([...ticket.tags.filter((t) => !t.startsWith("level:")), triage!.intent, `level:${crit.level}`])],
          level: crit.level,
          handled_by: crit.handled_by,
        });
        await api.addComment(ticket.id, {
          public: false,
          body: `ResolveAI triage: ${LEVEL_LABEL[crit.level]} → ${HANDLER_LABEL[crit.handled_by]}.\nWhy: ${crit.reasons.join("; ")}.\nPlan:\n${triage!.plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
        });
        await step("main", { step: isNew ? "Open ticket" : "Update ticket", tool: "Zendesk", result: "success", detail: `#${ticket.id}: ${LEVEL_LABEL[crit.level]}, routed to ${HANDLER_LABEL[crit.handled_by]}` });
      };

      if (crit.handled_by === "human") {
        await recordTriage();
        return escalateCritical(run.id, ticket, customer_id, triage, crit, order);
      }

      // The main agent answers straight away; the bookkeeping and the level agent's work happen in the
      // background, and its reply lands on the ticket (the ShopKart chat watches the ticket) when it's done.
      const ack = `Thanks, ${customer.name.split(" ")[0]}. I'm on it: this is ticket #${ticket.id}, and I'll get back to you here in a few minutes.`;
      await api.addComment(ticket.id, { body: ack, public: true });
      track(
        (async () => {
          await step("main", { step: "Acknowledge", tool: channel.name, result: "success", detail: `Told the customer ${HANDLER_LABEL[crit.handled_by]} is on it` });
          await recordTriage();
          await platform.updateRun(run.id, { reply: ack });
          await work(run.id, ticket, isNew, customer.name, customer_id, session_id, message, triage!, crit);
        })().catch((e) => log.error(`[agent] background work on ticket #${ticket.id} failed:`, e)),
      );
      return { status: 200, body: { reply: ack, ticket_id: ticket.id } };
    });
  }

  /** Critical: a person takes it. The main agent writes the brief; the customer is told straight away. */
  async function escalateCritical(runId: number, ticket: Ticket, customerId: number, triage: Triage, crit: Criticality, order: Order | null): Promise<Result<ChatResponse>> {
    const money = triage.intent === "payment_failed" || triage.intent === "refund" || triage.intent === "damaged_item" || order?.payment_status === "failed_debited";
    const assignee = money ? SUPPORT_AGENTS[0] : SUPPORT_AGENTS[1];
    await api.addComment(ticket.id, {
      public: false,
      body: [
        `Critical: handed to ${assignee} by ResolveAI.`,
        `What happened: ${triage.summary}`,
        order ? `Order #${order.id}: ${rupees(order.amount)}, ${order.status}, payment ${order.payment_status}.` : null,
        `Why critical: ${crit.reasons.join("; ")}.`,
        `Suggested next steps:\n${triage.plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
      ].filter(Boolean).join("\n"),
    });
    await api.updateTicket(ticket.id, { assignee, priority: "urgent", status: "open", handled_by: "human" });
    const reply = money
      ? `I'm sorry about this. I've flagged it as urgent (ticket #${ticket.id}) and our payments team will get back to you within 2 hours.`
      : `I'm sorry about this. I've passed it to a senior teammate as an urgent case (ticket #${ticket.id}); they'll get back to you here shortly.`;
    await api.addComment(ticket.id, { body: reply, public: true });
    await platform.updateRun(runId, { status: "escalated", reply });
    await stepper(runId)("main", { step: "Escalate to human", tool: "Zendesk", result: "escalated", detail: `Critical, assigned to ${assignee}` });
    await remember(runId, { ticketId: ticket.id, customerId, intent: triage.intent, level: crit.level, handledBy: "human", problem: triage.summary, resolution: `Handed to ${assignee} with a brief. Told the customer: ${reply}`, outcome: "escalated" });
    return { status: 200, body: { reply, ticket_id: ticket.id } };
  }

  /** Low, medium or high: that level's agent works the ticket with its own tools. */
  async function work(runId: number, ticket: Ticket, isNew: boolean, customerName: string, customerId: number, sessionId: string, message: string, triage: Triage, crit: Criticality): Promise<Result<ChatResponse>> {
    const level = crit.handled_by as "low" | "medium" | "high";
    const prompt = [
      `[Zendesk ticket #${ticket.id}${isNew ? " (new)" : ""} · customer ${customerName} (id ${customerId}) · today ${today()}]`,
      `Level: ${LEVEL_LABEL[crit.level]} (${crit.reasons.join("; ")})`,
      `Main agent's plan:\n${triage.plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
      `Customer message: ${message}`,
    ].join("\n");

    let reply: string;
    try {
      const res = await levels[level].generateText(prompt, {
        userId: `customer-${customerId}`,
        conversationId: sessionId,
        context: runContext({ ticketId: ticket.id, customerId, runId, agent: level }),
      });
      reply = res.text.trim();
      if (!reply) throw new Error("the model returned an empty reply");
    } catch (e) {
      log.error(`[agent] ${level} agent failed on ticket #${ticket.id}:`, e);
      return handOver(runId, ticket, sessionId, customerId, message, `the ${level} agent failed (${errorText(e)})`, true);
    }

    await api.addComment(ticket.id, { body: reply, public: true });
    const [after, run] = await Promise.all([api.ticket(ticket.id), platform.run(runId)]);
    const escalated = !!after.assignee && after.assignee !== BOT;
    const status = run.status === "waiting_approval" ? "waiting_approval" : escalated ? "escalated" : after.status === "solved" ? "resolved" : "working";
    await platform.updateRun(runId, { status, reply, ...(escalated && { handled_by: "human" }) });
    if (status === "resolved" || status === "escalated") {
      await remember(runId, { ticketId: ticket.id, customerId, intent: triage.intent, level: crit.level, handledBy: escalated ? "human" : level, problem: triage.summary, resolution: reply, outcome: status === "resolved" ? "resolved" : "escalated" });
    }
    return { status: 200, body: { reply, ticket_id: ticket.id } };
  }

  /** "Any update?": answer from the ticket, its latest run and any pending approval. */
  async function statusUpdate(runId: number, ticket: Ticket, message: string, triage: Triage, fromOtherChat: boolean): Promise<Result<ChatResponse>> {
    await addCustomerMessage(ticket, message);
    const [runs, approval] = await Promise.all([platform.runsForTicket(ticket.id).catch(() => []), platform.pendingApprovalFor(ticket.id).catch(() => undefined)]);
    const last = runs.find((r) => r.id !== runId && r.kind === "request");
    const lastReply = [...ticket.comments].reverse().find((c) => c.public && c.author_type !== "customer");
    const facts = {
      ticket: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      with: ticket.assignee === BOT ? "ResolveAI" : (ticket.assignee ?? "the support queue"),
      waiting_for_approval: approval ? `${rupees(approval.amount)} refund for order #${approval.order_id}` : null,
      last_update_to_customer: lastReply?.body ?? null,
      last_action: last?.steps?.filter((s) => s.agent !== "main").at(-1)?.detail ?? null,
    };

    let reply = fallbackStatus(facts);
    try {
      const res = await writer.generateText(
        `Write the customer a short status update (1–2 plain sentences) using only these facts. Mention the ticket number. Facts: ${JSON.stringify(facts)}\nTheir message: ${message}`,
      );
      const text = res.text.trim();
      if (text && !/^[{[]/.test(text)) reply = text; // never send the model's JSON to a customer
    } catch (e) {
      log.warn(`[agent] status update for #${ticket.id} fell back to a template:`, errorText(e));
    }

    await api.addComment(ticket.id, { body: reply, public: true });
    await platform.updateRun(runId, { kind: "status_check", ticket_id: ticket.id, intent: triage.intent, level: ticket.level, handled_by: ticket.handled_by, status: "resolved", reply, plan: ["Read the ticket and its latest work", "Tell the customer where it stands"] });
    await stepper(runId)("main", { step: "Status update", tool: "Zendesk", result: "success", detail: `#${ticket.id} is ${ticket.status}${approval ? ", waiting for approval" : ""}${fromOtherChat ? " (found from the customer's tickets)" : ""}` });
    return { status: 200, body: { reply, ticket_id: ticket.id } };
  }

  /** Not a ShopKart matter: answer politely. No ticket is opened; an existing chat ticket just gets the exchange. */
  async function outOfScope(runId: number, known: Ticket | null, message: string, triage: Triage): Promise<Result<ChatResponse>> {
    const reply = "Sorry, I can only help with ShopKart orders, deliveries, refunds and payments. Is there anything about an order I can help you with?";
    if (known) {
      await addCustomerMessage(known, message);
      await api.addComment(known.id, { body: reply, public: true });
    }
    await platform.updateRun(runId, { ticket_id: known?.id ?? null, intent: triage.intent, status: "resolved", reply, plan: ["Not a ShopKart request: reply politely, no ticket"] });
    await stepper(runId)("main", { step: "Out of scope", tool: "Aria LLM", result: "success", detail: `${triage.summary} (no ticket opened)` });
    return { status: 200, body: { reply, ...(known && { ticket_id: known.id }) } };
  }

  /**
   * We don't have the data to answer (no orders, no earlier request): the ticket goes to the support team
   * with a note saying what's missing, and the customer is told the team is on it.
   */
  async function toTeam(runId: number, known: Ticket | null, sessionId: string, customerId: number, message: string, triage: Triage, why: string): Promise<Result<ChatResponse>> {
    const { ticket } = await ticketFor(known, sessionId, customerId, message);
    const assignee = SUPPORT_AGENTS[1];
    await api.addComment(ticket.id, { public: false, body: `Handed to ${assignee} by ResolveAI: the customer ${why}.\nWhat they said: ${triage.summary}\nPlease check with the customer and follow up on this ticket.` });
    await api.updateTicket(ticket.id, { assignee, status: "open", priority: "normal", handled_by: "human", tags: [...new Set([...ticket.tags, triage.intent, "needs-data"])] });
    const reply = `I couldn't find what I need to sort this out myself, so I've passed it to our support team (ticket #${ticket.id}). They're looking into it and will get back to you here shortly.`;
    await api.addComment(ticket.id, { body: reply, public: true });
    await platform.updateRun(runId, { ticket_id: ticket.id, intent: triage.intent, handled_by: "human", status: "escalated", reply, plan: ["No data to answer from", `Hand to ${assignee}`, "Tell the customer the team is on it"] });
    await stepper(runId)("main", { step: "Hand to team", tool: "Zendesk", result: "escalated", detail: `No data: the customer ${why}. Assigned to ${assignee}` });
    return { status: 200, body: { reply, ticket_id: ticket.id } };
  }

  /** When a model fails: the ticket goes to a person and the customer still gets an answer. */
  async function handOver(runId: number, known: Ticket | null, sessionId: string, customerId: number, message: string, why: string, alreadyAttached = false): Promise<Result<ChatResponse>> {
    const ticket = alreadyAttached && known ? known : (await ticketFor(known, sessionId, customerId, message)).ticket;
    await api.addComment(ticket.id, { public: false, body: `Aria couldn't handle this message: ${why}. Needs a person.` });
    await api.updateTicket(ticket.id, { assignee: null, status: "open", handled_by: "human" });
    const reply = `Thanks for reaching out. I've logged this as ticket #${ticket.id} and a teammate will get back to you shortly.`;
    await api.addComment(ticket.id, { body: reply, public: true });
    await platform.updateRun(runId, { ticket_id: ticket.id, handled_by: "human", status: "failed", reply });
    await stepper(runId)("main", { step: "Hand over", tool: "Zendesk", result: "blocked", detail: why });
    return { status: 200, body: { reply, ticket_id: ticket.id } };
  }

  /* ───── Approvals ───── */

  /** A person approved or rejected a high-level action in the Control Room. Carry it out and tell the customer. */
  type Decided = Result<{ ok: true; reply: string }>;
  async function approvalDecided(approvalId: number): Promise<Decided> {
    return guard<{ ok: true; reply: string }>(async (): Promise<Decided> => {
      const a = await platform.approval(approvalId);
      if (a.status === "pending") return { status: 409, body: { error: `Approval ${approvalId} hasn't been decided yet` } };
      const [run, ticket] = await Promise.all([platform.run(a.run_id), api.ticket(a.ticket_id)]);
      const step = stepper(run.id);
      const by = a.decided_by ?? "a teammate";
      const level = run.level ?? "high";
      let reply: string;
      let outcome: CaseOutcome;

      if (a.status === "approved") {
        await step("human", { step: "Approved", tool: "Approvals", result: "success", detail: `${by} approved: ${a.suggestion}${a.note ? ` (${a.note})` : ""}` });
        try {
          await api.refundOrder(a.order_id);
        } catch (e) {
          const why = errorText(e);
          await api.addComment(ticket.id, { public: false, body: `Approved by ${by}, but the refund failed: ${why}. Needs a person.` });
          await api.updateTicket(ticket.id, { assignee: SUPPORT_AGENTS[0], status: "open", handled_by: "human" });
          reply = `Your refund was approved, but I couldn't start it automatically. ${SUPPORT_AGENTS[0].split(" – ")[0]} from our team will complete it and update you here (ticket #${ticket.id}).`;
          await api.addComment(ticket.id, { body: reply, public: true });
          await step("high", { step: "Refund", tool: "Paytm", result: "blocked", detail: why });
          await platform.updateRun(run.id, { status: "escalated", handled_by: "human", reply });
          await remember(run.id, { ticketId: ticket.id, customerId: run.customer_id, intent: run.intent ?? "refund", level, handledBy: "human", problem: a.summary || a.reason, resolution: reply, outcome: "escalated" });
          return { status: 200, body: { ok: true as const, reply } };
        }
        await api.addComment(ticket.id, { public: false, body: `Approved by ${by}${a.note ? ` (${a.note})` : ""}. Refund of ${rupees(a.amount)} started for order #${a.order_id}.` });
        await step("high", { step: "Refund", tool: "Paytm", result: "success", detail: `${rupees(a.amount)} refunded for #${a.order_id} after approval` });
        reply = `Good news: your refund of ${rupees(a.amount)} for order #${a.order_id} is approved and has been started. It reaches your original payment method in 3–5 working days (ticket #${ticket.id}).`;
        await api.addComment(ticket.id, { body: reply, public: true });
        await api.updateTicket(ticket.id, { status: "solved" });
        await platform.updateRun(run.id, { status: "resolved", reply });
        outcome = "resolved";
      } else {
        await step("human", { step: "Rejected", tool: "Approvals", result: "blocked", detail: `${by} rejected${a.note ? `: ${a.note}` : ""}` });
        await api.addComment(ticket.id, { public: false, body: `Refund rejected by ${by}${a.note ? `: ${a.note}` : ""}. Over to ${SUPPORT_AGENTS[0]}.` });
        await api.updateTicket(ticket.id, { assignee: SUPPORT_AGENTS[0], status: "open", handled_by: "human" });
        reply = `Thanks for your patience. A teammate is reviewing your request personally (ticket #${ticket.id}) and will get back to you here shortly.`;
        await api.addComment(ticket.id, { body: reply, public: true });
        await platform.updateRun(run.id, { status: "escalated", handled_by: "human", reply });
        outcome = "rejected";
      }
      await remember(run.id, { ticketId: ticket.id, customerId: run.customer_id, intent: run.intent ?? "refund", level, handledBy: outcome === "resolved" ? "high" : "human", problem: a.summary || a.reason, resolution: reply, outcome });
      return { status: 200, body: { ok: true as const, reply } };
    });
  }

  /* ───── Leads (sales agent, unchanged) ───── */

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
        // One thread per person: a second enquiry from the same email sees what happened with the first.
        const res = await sales.generateText(prompt, {
          userId: `person:${personKey(b.email)}`,
          conversationId: `sales:${personKey(b.email)}`,
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

  async function analyze(raw: unknown): Promise<Result<AnalysisResponse>> {
    const parsed = AnalysisBody.safeParse(raw ?? {});
    if (!parsed.success) return invalid(parsed.error);
    const { focus, scope } = parsed.data;

    return guard<AnalysisResponse>(async () => {
      const run: AnalysisRun = { kind: "analysis", scope };
      const prompt =
        scope === "sales"
          ? `[Sales analysis for the Control Room's Sales area · today ${today()}]\nScope: sales only (pipeline, lead scores, campaigns, lead sources).\nFocus: ${focus || "how the pipeline and campaigns are doing, and what sales should do next"}`
          : `[Control Room analysis request · today ${today()}]\nFocus: ${focus || "a general health check of support, sales, the shop and campaigns"}`;
      try {
        // No raw history (contextLimit 0): what Aria knows about earlier runs is the working-memory note, which
        // VoltAgent puts in the system prompt, plus get_previous_reports. The run itself is still saved.
        await analysis.generateText(prompt, { memory: { ...analysisThread(scope), options: { contextLimit: 0 } }, context: runContext(run) });
      } catch (e) {
        log.error("[agent] analysis agent failed:", e);
        if (!run.report) return { status: 502, body: { error: `Aria couldn't finish the analysis (${errorText(e)}).` } };
      }
      if (!run.report) return { status: 502, body: { error: "Aria finished without publishing a report. Try again." } };
      await rememberReport(run.report);
      return { status: 201, body: { report: run.report } };
    });
  }

  async function syncLeads(raw: unknown): Promise<Result<LeadSyncResponse>> {
    const parsed = LeadSyncBody.safeParse(raw ?? {});
    if (!parsed.success) return invalid(parsed.error);
    const { limit } = parsed.data;

    return guard(async () => {
      const { responses: queue } = await api.newResponses();
      const batch = queue.slice(0, limit);
      // Responses from the same person share a memory thread: run those one after another, people in parallel.
      const byPerson = [...Map.groupBy(batch, (r) => personKey(r.email)).values()];
      const done = await mapPool(byPerson, LEAD_CONCURRENCY, async (mine) => {
        const out: LeadSyncResult[] = [];
        for (const r of mine) out.push(await workResponse(r));
        return out;
      });
      const order = new Map(batch.map((r, i) => [r.id, i]));
      const results = done.flat().sort((a, b) => order.get(a.response_id)! - order.get(b.response_id)!);
      const of = (o: LeadSyncResult["outcome"]) => results.filter((x) => x.outcome === o).length;
      return {
        status: 200,
        body: { processed: results.length, converted: of("converted"), skipped: of("skipped"), failed: of("failed"), remaining: queue.length - batch.length + of("failed"), results },
      };
    });
  }

  /** Runs the leads agent on one campaign response. Never throws: a failure is reported and the response stays new. */
  async function workResponse(r: CampaignResponse): Promise<LeadSyncResult> {
    const base = { response_id: r.id, name: r.name, company: r.company, campaign: r.campaign.name };
    const run: LeadsRun = { kind: "leads", responseId: r.id, budget: r.budget ?? 0 };
    try {
      const { existing_contact } = await api.campaignResponse(r.id);
      const need = ENQUIRY_NEEDS.find((n) => n.id === r.need)?.label ?? r.need;
      const prompt = [
        `Campaign response #${r.id} · "${r.campaign.name}" (${r.campaign.channel}) · today ${today()}`,
        `Name: ${r.name}`,
        `Company: ${r.company || "not given"}`,
        `Email: ${r.email}`,
        `Need: ${need}`,
        `Budget: ${r.budget == null ? "not given" : rupees(r.budget)}`,
        `Wants to start: ${r.start_when || "not given"}`,
        `Message: ${r.message}`,
        `CRM: ${crmLine(existing_contact)}`,
      ].join("\n");
      const who = personKey(r.email);
      const res = await leads.generateText(prompt, { userId: `person:${who}`, conversationId: `leads:${who}`, context: runContext(run) });
      if (!run.outcome) return { ...base, outcome: "failed", reason: `Aria didn't decide: ${res.text.trim().slice(0, 160) || "no answer"}` };
    } catch (e) {
      log.error(`[agent] leads agent failed on campaign response #${r.id}:`, e);
      if (!run.outcome) return { ...base, outcome: "failed", reason: errorText(e) };
    }
    const o = run.outcome!;
    return o.outcome === "converted" ? { ...base, outcome: "converted", deal_id: o.dealId, score: o.score, reason: o.reason } : { ...base, outcome: "skipped", reason: o.reason };
  }

  /** Rewrites the analysis thread's working-memory note. A failure here never fails the request. */
  async function rememberReport(report: NonNullable<AnalysisRun["report"]>) {
    if (!analysisMemory) return;
    try {
      const thread = analysisThread(report.scope ?? "all");
      const previous = await analysisMemory.getWorkingMemory(thread);
      await analysisMemory.updateWorkingMemory({ ...thread, content: analysisNote(report, previous), options: { mode: "replace" } });
    } catch (e) {
      log.warn("[agent] couldn't update the analysis memory note:", e);
    }
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

  return { intake, approvalDecided, lead, analyze, syncLeads, settled };
}

/** An order number the customer typed after the word "order" ("order 1023", "order no. #1023"). */
function mentionedOrder(message: string): number | null {
  const m = message.match(/\border\s*(?:no\.?|number|id)?\s*#?\s*(\d{3,})\b/i);
  return m ? Number(m[1]) : null;
}

const orderBrief = (o: Order) => ({ id: o.id, status: o.status, payment_status: o.payment_status, amount: o.amount, items: o.items.map((i) => i.name) });

function subjectFor(t: Triage, order: Order | null): string {
  const what: Record<Triage["intent"], string> = {
    order_tracking: "Where is my order",
    question: "Question",
    damaged_item: "Damaged item, refund requested",
    refund: "Refund requested",
    cancel_order: "Cancel order",
    address_change: "Change delivery address",
    payment_failed: "Money debited, payment failed",
    account: "Account issue",
    complaint: "Complaint",
    other: "Support request",
    out_of_scope: "Not a ShopKart request",
  };
  return `${what[t.intent]}${order ? ` – order #${order.id}` : ""}`;
}

function fallbackStatus(f: { ticket: number; status: string; with: string; waiting_for_approval: string | null }): string {
  if (f.status === "solved") return `Your request (ticket #${f.ticket}) is resolved. Let me know if anything else needs fixing.`;
  if (f.waiting_for_approval) return `Your ${f.waiting_for_approval} is with a teammate for approval (ticket #${f.ticket}). You'll hear back here shortly.`;
  return `Your request (ticket #${f.ticket}) is being handled by ${f.with}. You'll get an update here as soon as there's progress.`;
}

function crmLine(c: KnownContact | null): string {
  if (!c) return "no contact with this email yet";
  const open = c.deals.filter((d) => d.stage !== "closed_won" && d.stage !== "closed_lost");
  if (!open.length) return `already a contact (#${c.id}, ${c.company}), no open deals`;
  return `already a contact (#${c.id}, ${c.company}) with open deals: ${open.map((d) => `#${d.id} ${d.name} (${d.stage}, ${rupees(d.amount)})`).join("; ")}`;
}

/** Like Promise.all over `items`, with at most `size` running at once. Keeps the input order. */
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

function invalid(error: z.ZodError): Result<never> {
  return { status: 400, body: { error: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") } };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

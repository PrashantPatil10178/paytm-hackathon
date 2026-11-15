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
  liveOrders,
  ordersNamedIn,
  rupees,
  OWNER,
  SUPPORT_AGENTS,
  type AgentRun,
  type AnalysisResponse,
  type CampaignResponse,
  type CaseOutcome,
  type ChatAnswer,
  type ChatQuestion,
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
import { assessCriticality, MIN_CONFIDENCE, ORDER_INTENTS, type Criticality } from "./criticality.ts";
import { DemoAPIError, type DemoAPI, type KnownContact } from "./demo-api.ts";
import { DEFAULT_RULES, rulesFrom } from "./evidence.ts";
import { analysisNote, analysisThread, personKey } from "./memory.ts";
import type { Platform } from "./platform.ts";
import type { PolicyBook } from "./policies.ts";
import { modeLine, schedule, type Schedule } from "./settings.ts";
import { memorySessions, type SessionStore } from "./sessions.ts";
import { runContext, type AnalysisRun, type LeadsRun, type SupportRun } from "./tools/context.ts";

const ChatBody = z.object({
  session_id: z.string().min(1),
  customer_id: z.coerce.number().int().positive(),
  message: z.string().trim().min(1),
  /** The customer's answer to a question we asked (which order, or photos), with the message it was about. */
  answer: z
    .object({ kind: z.enum(["order", "photos"]), original: z.string().trim().min(1).max(2000), value: z.string().nullable(), text: z.string().trim().min(1).max(200) })
    .optional(),
  /** Photos sent with the message (attachment ids; the demo API keeps only the customer's own) */
  attachments: z.array(z.coerce.number().int().positive()).max(3).default([]),
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
  /** How long /intake waits for a ticket's level agent before answering "I'm on it" instead (ms). Default 8 s. */
  ackAfterMs?: number;
  /** ShopKart's policy book: POL-DMG's photo threshold for the photo request */
  book?: PolicyBook;
  /** "Now", for business hours (tests) */
  now?: () => Date;
}

export function createService({ api, platform, main, writer, levels, sales, analysis, leads, sessions = memorySessions(), analysisMemory, log = console, ackAfterMs = 8_000, book, now = () => new Date() }: ServiceDeps) {
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

  /* ───── Chats and tickets ───── */

  /**
   * One chat message being handled, and what this chat said before it. A low-level question is answered
   * without a ticket; the first time this chat needs a ticket, the exchanges it had without one are copied
   * onto the ticket so the team sees the whole conversation.
   */
  interface Chat {
    runId: number;
    /** The channel's name, for steps ("ShopKart chat") */
    channel: string;
    sessionId: string;
    customerId: number;
    customerName: string;
    /** The message being worked (for an answer to "which order?": the original request plus the answer) */
    message: string;
    /** Earlier runs in this chat, oldest first */
    earlier: AgentRun[];
    /** This chat's exchanges since its last ticket that never got one, oldest first */
    history: { message: string; reply: string }[];
    /** Photos sent with this message (attachment ids) */
    attachments: number[];
    /** Business hours and the autonomy that applies now */
    schedule: Schedule;
  }

  /** The ticket this chat session already has, if it still exists (a demo reset recycles ticket numbers). */
  async function knownTicket(sessionId: string): Promise<Ticket | null> {
    const [known, stored] = await Promise.all([sessions.get(sessionId), api.chatSession(sessionId).catch(() => null)]);
    // A person who joined this chat from the Control Room opened its ticket there (tagged live-chat), so this
    // service never saw it. After they hand the chat back, Aria carries on with that ticket.
    if (stored?.ticket_id && (!known || stored.ticket_id > known.ticketId)) {
      const t = await api.ticket(stored.ticket_id).catch(() => null);
      if (t?.tags.includes("live-chat")) {
        await sessions.set(sessionId, { ticketId: t.id, ticketCreatedAt: t.created_at });
        return t;
      }
    }
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

  async function addCustomerMessage(t: Ticket, message: string, attachments: number[] = []) {
    await api.addComment(t.id, { body: message, public: true, author: t.requester.name, author_type: "customer", ...(attachments.length && { attachment_ids: attachments }) });
  }

  /**
   * Reuses the chat's ticket (adding the message, reopening it if solved) or opens a new one. A new ticket
   * starts with what this chat said without a ticket (customer messages and Aria's answers), then this message.
   */
  async function ticketFor(known: Ticket | null, c: Chat): Promise<{ ticket: Ticket; isNew: boolean }> {
    if (known) {
      await addCustomerMessage(known, c.message, c.attachments);
      const ticket = known.status === "solved" ? await api.updateTicket(known.id, { status: "open" }) : known;
      return { ticket, isNew: false };
    }
    const thread = [...c.history.flatMap((h) => [{ customer: true, body: h.message }, { customer: false, body: h.reply }]), { customer: true, body: c.message }];
    const first = thread[0]!.body;
    // Photos ride on the comment of the message they came with, so a lone first message goes on as a comment.
    const photosFirst = thread.length === 1 && c.attachments.length > 0;
    const ticket = await api.createTicket({
      subject: first.length > 60 ? `${first.slice(0, 57)}…` : first,
      ...(!photosFirst && { comment: first }),
      requester_id: c.customerId,
      via: "chat",
      status: "open",
      assignee: BOT,
      tags: ["chat"],
    });
    if (photosFirst) await addCustomerMessage(ticket, first, c.attachments);
    for (const [i, m] of thread.slice(1).entries()) {
      if (m.customer) await addCustomerMessage(ticket, m.body, i === thread.length - 2 ? c.attachments : []);
      else await api.addComment(ticket.id, { body: m.body, public: true });
    }
    await sessions.set(c.sessionId, { ticketId: ticket.id, ticketCreatedAt: ticket.created_at });
    return { ticket, isNew: true };
  }

  /** Writes the triage onto the run and the ticket (level, who handles it, priority, triage note). */
  async function recordTriage(c: Chat, ticket: Ticket, isNew: boolean, triage: Triage, crit: Criticality, order: Order | null, why = "") {
    await platform.updateRun(c.runId, {
      ticket_id: ticket.id,
      intent: triage.intent,
      level: crit.level,
      level_reason: crit.reasons.join("; "),
      handled_by: crit.handled_by,
      plan: triage.plan,
      status: "working",
    });
    await api.updateTicket(ticket.id, {
      ...(isNew && { subject: subjectFor(triage, order) }),
      priority: crit.level,
      type: triage.intent === "order_tracking" || triage.intent === "question" ? "question" : "incident",
      tags: [...new Set([...ticket.tags.filter((t) => !t.startsWith("level:") && t !== AWAITING_PHOTOS), triage.intent, `level:${crit.level}`])],
      level: crit.level,
      handled_by: crit.handled_by,
    });
    await api.addComment(ticket.id, {
      public: false,
      body: `ResolveAI triage: ${LEVEL_LABEL[crit.level]} → ${HANDLER_LABEL[crit.handled_by]}.\nWhy: ${crit.reasons.join("; ")}.\nPlan:\n${triage.plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
    });
    await stepper(c.runId)("main", { step: isNew ? "Open ticket" : "Update ticket", tool: "Zendesk", result: "success", detail: `#${ticket.id}: ${LEVEL_LABEL[crit.level]}, routed to ${HANDLER_LABEL[crit.handled_by]}${why}` });
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
    const { session_id, customer_id, attachments } = parsed.data;
    let answer: ChatAnswer | undefined = parsed.data.answer;

    return guard(async () => {
      // An answer to "which order?" is worked as the original request plus the order it names.
      const run = await platform.createRun({ channel_id: channel.id, session_id, customer_id, message: answer ? answerMessage(answer) : parsed.data.message });
      const step = stepper(run.id);
      const photoNote = attachments.length ? ` (+${attachments.length} photo${attachments.length === 1 ? "" : "s"})` : "";
      await step("main", { step: "Receive request", tool: channel.name, result: "success", detail: `${(answer ? answerMessage(answer) : parsed.data.message).slice(0, 160)}${photoNote}` });

      const [{ customer, orders }, sessionTicket, earlierRuns, settings] = await Promise.all([
        api.customerOrders(customer_id),
        knownTicket(session_id),
        platform.runsForSession(session_id).catch(() => [] as AgentRun[]),
        platform.settings(),
      ]);
      const sc = schedule(settings, now());
      const earlier = earlierRuns.filter((r) => r.id !== run.id).sort((a, b) => a.id - b.id);

      /* 0. The support playbook is off in the Control Room: no agent acts. The owner gets the ticket. */
      if (!settings.playbooks.support) {
        const c0: Chat = { runId: run.id, channel: channel.name, sessionId: session_id, customerId: customer_id, customerName: customer.name, message: parsed.data.message, earlier, history: [], attachments, schedule: sc };
        return playbookOff(c0, sessionTicket && sessionTicket.status !== "solved" ? sessionTicket : null);
      }

      // A typed answer right after "which order?" (instead of tapping a choice) answers it too, if it names one order.
      const prev = earlier.at(-1);
      if (!answer && prev?.steps?.some((s) => s.step === "Ask which order")) {
        const hit = ordersNamedIn(parsed.data.message, orders);
        if (hit.length === 1) answer = { kind: "order", original: prev.message, value: String(hit[0]!.id), text: parsed.data.message };
      }
      const message = answer ? answerMessage(answer) : parsed.data.message;
      const picked = answer ? (answer.value && /^\d+$/.test(answer.value) ? Number(answer.value) : mentionedNumber(answer.text)) : null;

      const lastTicketed = Math.max(0, ...earlier.filter((r) => r.ticket_id).map((r) => r.id));
      const history = earlier
        .filter((r) => r.id > lastTicketed && !r.ticket_id && r.reply && !(answer && r.message === answer.original))
        .map((r) => ({ message: r.message, reply: r.reply! }));
      const c: Chat = { runId: run.id, channel: channel.name, sessionId: session_id, customerId: customer_id, customerName: customer.name, message, earlier, history, attachments, schedule: sc };
      const cases = await platform.searchCases(message).catch(() => []);

      /* 1. The main agent triages. */
      const prompt = [
        `Today: ${today()}. Customer: ${customer.name} (id ${customer_id}).`,
        `Their orders: ${JSON.stringify(orders.map(orderBrief))}`,
        sessionTicket ? `Ticket in this chat: #${sessionTicket.id} "${sessionTicket.subject}", status ${sessionTicket.status}, assignee ${sessionTicket.assignee ?? "nobody"}.` : "No ticket in this chat yet.",
        ...earlierLines(c),
        cases.length ? `Similar past cases: ${JSON.stringify(cases.map((x) => ({ problem: x.problem, resolution: x.resolution, level: x.level, outcome: x.outcome })))}` : "No similar past cases.",
        answer?.kind === "order" ? `They were asked which order this is about and answered: ${answer.text}.` : null,
        answer?.kind === "photos" ? `They were asked for photos of the damage and sent ${attachments.length}.` : attachments.length ? `They attached ${attachments.length} photo${attachments.length === 1 ? "" : "s"}.` : null,
        `Message: ${message}`,
      ].filter(Boolean).join("\n");
      let triage: Triage | null = null;
      try {
        const res = await main.generateText(prompt, { output: Output.object({ schema: TriageSchema }), userId: `customer-${customer_id}`, conversationId: `${session_id}:main` });
        triage = res.output as Triage;
      } catch (e) {
        log.error(`[agent] main agent couldn't triage run ${run.id}:`, e);
      }
      if (!triage) return handOver(c, sessionTicket, "the main agent couldn't read the request");
      if (answer) triage.kind = "new_request"; // an answer continues the request; it isn't asking for an update
      // Photos for a claim that is waiting on them continue that claim, whatever the caption says.
      const photosFor = answer?.kind === "photos" || (attachments.length > 0 && !!sessionTicket?.tags.includes(AWAITING_PHOTOS) && sessionTicket.status !== "solved");
      if (photosFor) Object.assign(triage, { kind: "new_request", intent: "damaged_item" });
      await step("main", { step: "Triage", tool: "Aria LLM", result: "success", detail: `${triage.kind === "status_check" ? "status check" : "new request"}, ${triage.intent}, confidence ${Math.round(triage.confidence * 100)}%${triage.signals.angry ? ", upset" : ""}: ${triage.summary}` });

      // The chat's ticket is reused while it's unsolved, or for a follow-up on the same issue. A new problem after
      // it was solved starts fresh (its own ticket, or none if it's a simple question).
      let named = picked ? orders.filter((o) => o.id === picked) : ordersNamedIn(message, orders);
      const known = sessionTicket && (sessionTicket.status !== "solved" || triage.kind === "status_check" || sameIssue(sessionTicket, triage, named)) ? sessionTicket : null;

      /* 2. Out of scope: a polite answer, no ticket and no one pulled in. */
      if (triage.intent === "out_of_scope") return outOfScope(c, known, triage);

      /* 3. A status check: answer from the earlier answer in this chat, or the ticket. Upset, asking for a person or
            unsure → it becomes a request and gets a ticket. No earlier request at all → the team. */
      let forceTicket = false;
      if (triage.kind === "status_check") {
        const answered = [...earlier].reverse().find((r) => r.kind === "request" && !r.ticket_id && r.reply && r.intent !== "out_of_scope" && r.id > lastTicketed);
        if (answered) {
          const s = triage.signals;
          if (!(s.angry || s.wants_human || s.fraud || s.legal || triage.confidence < MIN_CONFIDENCE)) return statusFromRun(c, answered, triage);
          forceTicket = true;
          if ((triage.intent === "question" || triage.intent === "other") && answered.intent) triage.intent = answered.intent as Triage["intent"];
          if (!named.length) named = ordersNamedIn(answered.message, orders); // it's about what they asked before
        } else {
          const ticket = known ?? (await latestTicket(customer_id));
          if (ticket) return statusUpdate(run.id, ticket, message, triage, !known);
          return toTeam(c, null, triage, "asked for an update, but we have no earlier request from this customer");
        }
      }

      /* 4. A person already owns this chat's open ticket: pass the message on, don't let the AI act over them. */
      if (known && known.status !== "solved" && known.assignee && known.assignee !== BOT) {
        await addCustomerMessage(known, message, attachments);
        const reply = `Thanks, I've added this to your ticket #${known.id}. ${known.assignee.split(" – ")[0]} from our team is on it and will reply here.`;
        await api.addComment(known.id, { body: reply, public: true });
        await platform.updateRun(run.id, { ticket_id: known.id, intent: triage.intent, plan: triage.plan, handled_by: "human", status: "escalated", reply });
        await step("main", { step: "Pass to owner", tool: "Zendesk", result: "escalated", detail: `#${known.id} is with ${known.assignee}` });
        return { status: 200, body: { reply, ticket_id: known.id } };
      }

      /* 5. About an order, but the customer has no orders: nothing for an agent to work with → the team. */
      if (ORDER_INTENTS.includes(triage.intent) && orders.length === 0) {
        return toTeam(c, known, triage, "asked about an order, but there are no orders on this account");
      }

      /* 6. An order number that isn't on their account: no agent can work it, so the team checks with them.
            Checked in code too ("order 9999", "order #9999"), in case the model left the number out. */
      const claimed = picked ?? mentionedOrder(message) ?? triage.order_id;
      if (claimed && !orders.some((o) => o.id === claimed)) {
        return toTeam(c, known, triage, `asked about order #${claimed}, which isn't on their account`);
      }

      /* 7. Which order? Never guessed for money: a refund, damage claim or cancellation needs the order named (number,
            item, or picked from the question), the chat ticket's order, or a customer with a single order. Otherwise
            ask, before anything is opened. The tools get the same list and refuse any other order. */
      const ticketOrder = known ? orders.find((o) => o.id === ticketOrderId(known)) : undefined;
      const confirmed = [...new Set([...named, ...(ticketOrder ? [ticketOrder] : [])])];
      const orderIds = [...new Set([...confirmed.map((o) => o.id), ...(orders.length === 1 ? [orders[0]!.id] : [])])];
      let order: Order | null = confirmed[0] ?? null;
      if (!order && triage.intent === "payment_failed") {
        // A payment claim is about an order whose payment failed. One such order: that's it. None: nothing to pick
        // from, so no "which order?" card; it goes straight to the owner with the customer's recent payments.
        const failed = candidateOrders("payment_failed", orders);
        if (failed.length === 1) order = failed[0]!;
        else if (failed.length > 1 && !answer && !forceTicket) return askWhichOrder(c, known && known.status !== "solved" ? known : null, triage, failed);
      } else if (!order && ASK_INTENTS.includes(triage.intent)) {
        const candidates = candidateOrders(triage.intent, orders);
        const sure = orders.length === 1 ? orders[0]! : !MONEY_INTENTS.includes(triage.intent) && candidates.length === 1 ? candidates[0]! : null;
        if (sure) order = sure;
        else if (!answer && !forceTicket) {
          // Nothing fits the request exactly (e.g. no delivered order for a damage claim): offer their unsettled orders.
          const offer = candidates.length ? candidates : liveOrders(orders).length ? liveOrders(orders) : orders;
          return askWhichOrder(c, known && known.status !== "solved" ? known : null, triage, offer);
        }
      }
      // Information only (no money moves on it): the model's reading of which order may stand.
      if (!order && !MONEY_INTENTS.includes(triage.intent)) order = orders.find((o) => o.id === triage!.order_id) ?? null;

      /* 8. Level, then route: a simple question is answered in the chat without a ticket; anything more gets one. */
      const recent = (await api.customerTickets(customer_id).catch(() => [])).filter((t) => t.id !== known?.id && Date.now() - new Date(t.created_at).getTime() < 30 * DAY).length;
      const refundLimit = settings.refundLimit;
      const crit = assessCriticality({
        intent: triage.intent,
        signals: triage.signals,
        confidence: triage.confidence,
        order,
        recentTickets: recent,
        refundLimit,
        verifiedDamageLimit: settings.verifiedDamageLimit,
        escalation: settings.escalation,
        autonomy: sc.mode,
        upsetBefore: !!earlier.at(-1)?.steps?.some((x) => x.step === "Triage" && /%, upset:/.test(x.detail)),
        lifetimeSpend: lifetimeSpend(orders),
      });
      await step("main", { step: "Set level", tool: "Criticality rules", result: "success", detail: `${LEVEL_LABEL[crit.level]}: ${crit.reasons.join("; ")}${sc.inHours ? "" : ` (after hours: ${sc.mode})`}` });

      if (!known && crit.handled_by === "low" && !forceTicket) return answerDirect(c, triage, crit, order, orderIds);

      const { ticket, isNew } = await ticketFor(known, c);
      if (crit.handled_by === "human") {
        await recordTriage(c, ticket, isNew, triage, crit, order);
        return escalateCritical(c, ticket, triage, crit, order, orders);
      }

      /* 9. Proof before money: a damage claim that needs a photo and has none asks for one (in code, no agent). */
      if (triage.intent === "damaged_item" && order) {
        const photos = (await api.ticketAttachments(ticket.id).catch(() => [])).filter((a) => a.order_id === null || a.order_id === order!.id);
        const rules = book ? rulesFrom(await book.all().catch(() => [])) : DEFAULT_RULES;
        const needed = settings.requireDamagePhotos || order.amount > rules.photoAbove;
        if (needed && !photos.length) {
          await recordTriage(c, ticket, isNew, triage, crit, order);
          const why = settings.requireDamagePhotos ? "the Control Room asks for photos on every damage claim" : `POL-DMG asks for a photo above ${rupees(rules.photoAbove)}`;
          return askForPhotos(c, ticket, triage, order, why);
        }
      }

      // The level agent works in the background and its reply lands on the ticket (the ShopKart chat watches it).
      // If it finishes within a few seconds its reply is the answer; only a slow one gets the "I'm on it" first.
      const out: { done?: Result<ChatResponse> } = {};
      const job = (async () => {
        await recordTriage(c, ticket, isNew, triage!, crit, order);
        return work(c, ticket, isNew, triage!, crit, refundLimit, orderIds, order);
      })();
      track(job.then((r) => (out.done = r)).catch((e) => log.error(`[agent] background work on ticket #${ticket.id} failed:`, e)));
      await Promise.race([job.catch(() => null), new Promise((r) => setTimeout(r, ackAfterMs))]);
      if (out.done) return out.done;
      const ack = `Thanks, ${customer.name.split(" ")[0]}. I'm on it: this is ticket #${ticket.id}, and I'll get back to you here in a few minutes.`;
      await api.addComment(ticket.id, { body: ack, public: true });
      await step("main", { step: "Acknowledge", tool: channel.name, result: "success", detail: `Told the customer ${HANDLER_LABEL[crit.handled_by]} is on it` });
      if (!out.done) await platform.updateRun(run.id, { reply: ack }).catch(() => {});
      return { status: 200, body: { reply: ack, ticket_id: ticket.id } };
    });
  }

  /** Earlier exchanges in this chat, for the agents' prompts. */
  function earlierLines(c: Chat): string[] {
    const done = c.earlier.filter((r) => r.reply).slice(-4);
    return done.length ? ["Earlier in this chat:", ...done.map((r) => `- Customer: ${r.message.slice(0, 200)} → Aria: ${r.reply!.slice(0, 240)}`)] : [];
  }

  /**
   * Low level, no ticket: the direct agent answers and its answer is the chat's reply. If it hands over to a
   * person, escalate_to_human opens the ticket then (through the run context), with the conversation so far.
   */
  async function answerDirect(c: Chat, triage: Triage, crit: Criticality, order: Order | null, orderIds: number[]): Promise<Result<ChatResponse>> {
    const step = stepper(c.runId);
    await platform.updateRun(c.runId, { intent: triage.intent, level: crit.level, level_reason: crit.reasons.join("; "), handled_by: crit.handled_by, plan: triage.plan, status: "working" });
    const ctx: SupportRun = {
      ticketId: null,
      customerId: c.customerId,
      runId: c.runId,
      agent: "low",
      orderIds,
      openTicket: async () => {
        const { ticket } = await ticketFor(null, c);
        await recordTriage(c, ticket, true, triage, crit, order, " (opened to hand over; answered in the chat until now)");
        const found = ((await platform.run(c.runId).catch(() => null))?.steps ?? []).filter((s) => s.agent === "low").map((s) => `- ${s.step}: ${s.detail}`);
        if (found.length) await api.addComment(ticket.id, { public: false, body: `What Aria checked before handing over:\n${found.join("\n")}` });
        return ticket.id;
      },
    };
    const prompt = [
      `[Chat with ${c.customerName} (customer id ${c.customerId}) · no ticket · today ${today()}]`,
      `Level: ${LEVEL_LABEL[crit.level]} (${crit.reasons.join("; ")})`,
      ...earlierLines(c),
      `Main agent's plan:\n${triage.plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
      `Customer message: ${c.message}`,
    ].join("\n");

    let reply: string;
    try {
      const res = await levels.direct.generateText(prompt, { userId: `customer-${c.customerId}`, conversationId: c.sessionId, context: runContext(ctx) });
      reply = res.text.trim();
      if (!reply) throw new Error("the model returned an empty reply");
    } catch (e) {
      log.error(`[agent] low agent failed on run ${c.runId}:`, e);
      const opened = ctx.ticketId ? await api.ticket(ctx.ticketId) : null;
      return handOver(c, opened, `the low agent failed (${errorText(e)})`, !!opened);
    }

    if (ctx.ticketId) {
      // It went to a person: the ticket now holds the conversation, and this reply goes there too.
      await api.addComment(ctx.ticketId, { body: reply, public: true });
      const after = await api.ticket(ctx.ticketId);
      const escalated = !!after.assignee && after.assignee !== BOT;
      await platform.updateRun(c.runId, { ticket_id: ctx.ticketId, status: escalated ? "escalated" : "resolved", reply, ...(escalated && { handled_by: "human" }) });
      await remember(c.runId, { ticketId: ctx.ticketId, customerId: c.customerId, intent: triage.intent, level: crit.level, handledBy: escalated ? "human" : "low", problem: triage.summary, resolution: reply, outcome: escalated ? "escalated" : "resolved" });
      return { status: 200, body: { reply, ticket_id: ctx.ticketId } };
    }
    await platform.updateRun(c.runId, { status: "resolved", reply });
    await step("main", { step: "Answer", tool: c.channel, result: "success", detail: "Answered in the chat; no ticket needed" });
    await remember(c.runId, { ticketId: null, customerId: c.customerId, intent: triage.intent, level: crit.level, handledBy: "low", problem: triage.summary, resolution: reply, outcome: "resolved" });
    return { status: 200, body: { reply } };
  }

  /** "Any update?" about something answered in this chat without a ticket: answer from that run. */
  async function statusFromRun(c: Chat, answered: AgentRun, triage: Triage): Promise<Result<ChatResponse>> {
    let reply = `Here's where that stands: ${answered.reply}`;
    try {
      const res = await writer.generateText(
        `The customer is asking again about something already answered in this chat (there is no ticket). Write 1–2 plain sentences telling them where it stands, using only these facts. Facts: ${JSON.stringify({ they_asked: answered.message, we_answered: answered.reply, answered_at: answered.updated_at })}\nTheir message: ${c.message}`,
      );
      const text = res.text.trim();
      if (text && !/^[{[]/.test(text)) reply = text;
    } catch (e) {
      log.warn(`[agent] status update for run ${answered.id} fell back to a template:`, errorText(e));
    }
    await platform.updateRun(c.runId, { kind: "status_check", intent: triage.intent, level: answered.level, handled_by: answered.handled_by, status: "resolved", reply, plan: ["Read the earlier answer in this chat", "Tell the customer where it stands"] });
    await stepper(c.runId)("main", { step: "Status update", tool: c.channel, result: "success", detail: `Answered from run #${answered.id} in this chat (no ticket)` });
    return { status: 200, body: { reply } };
  }

  /** Critical: a person takes it. The main agent writes the brief; the customer is told straight away. */
  async function escalateCritical(c: Chat, ticket: Ticket, triage: Triage, crit: Criticality, order: Order | null, orders: Order[]): Promise<Result<ChatResponse>> {
    const runId = c.runId;
    const money = triage.intent === "payment_failed" || order?.payment_status === "failed_debited";
    const assignee = SUPPORT_AGENTS[0];
    // A payment claim with no failed order: the owner gets the customer's recent orders and payments to check against.
    const recentPayments =
      money && !order
        ? `No order on the account shows a failed payment. Recent orders: ${orders.length ? [...orders].sort((a, b) => b.placed_at.localeCompare(a.placed_at)).slice(0, 5).map((o) => `#${o.id} ${rupees(o.amount)} (${o.status}, payment ${o.payment_status.replace(/_/g, " ")}, placed ${o.placed_at.slice(0, 10)})`).join("; ") : "none"}.`
        : null;
    await api.addComment(ticket.id, {
      public: false,
      body: [
        `Critical: handed to ${assignee} by ResolveAI.`,
        `What happened: ${triage.summary}`,
        order ? `Order #${order.id}: ${rupees(order.amount)}, ${order.status}, payment ${order.payment_status}.` : null,
        recentPayments,
        `Why critical: ${crit.reasons.join("; ")}.`,
        c.schedule.inHours ? null : `After hours: the customer was told the team is back ${c.schedule.back ?? "soon"} IST.`,
        `Suggested next steps:\n${triage.plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
      ].filter(Boolean).join("\n"),
    });
    await api.updateTicket(ticket.id, { assignee, priority: "urgent", status: "open", handled_by: "human" });
    const when = c.schedule.inHours ? "within 2 hours" : `when we're back ${c.schedule.back ?? "in the morning"} (IST)`;
    const reply = money
      ? order
        ? `I'm sorry about this. I've flagged it as urgent (ticket #${ticket.id}) and our payments team will get back to you ${when}.`
        : `I'm sorry about this. I can't see a failed payment on your recent orders, so I've passed it to our payments team as urgent (ticket #${ticket.id}). They'll check it with you ${when}.`
      : `I'm sorry about this. I've passed it to a senior teammate as an urgent case (ticket #${ticket.id}); they'll get back to you here ${c.schedule.inHours ? "shortly" : when}.`;
    await api.addComment(ticket.id, { body: reply, public: true });
    await platform.updateRun(runId, { status: "escalated", reply });
    await stepper(runId)("main", { step: "Escalate to human", tool: "Zendesk", result: "escalated", detail: `Critical, assigned to ${assignee}${recentPayments ? " with the customer's recent payments" : ""}` });
    await remember(runId, { ticketId: ticket.id, customerId: c.customerId, intent: triage.intent, level: crit.level, handledBy: "human", problem: triage.summary, resolution: `Handed to ${assignee} with a brief. Told the customer: ${reply}`, outcome: "escalated" });
    return { status: 200, body: { reply, ticket_id: ticket.id } };
  }

  /**
   * A damage claim that needs a photo and has none: ask for 1–3 (the chat shows an upload card), remind once, then
   * stop asking. No refund either way; the ticket waits on the customer until photos arrive.
   */
  async function askForPhotos(c: Chat, ticket: Ticket, triage: Triage, order: Order, why: string): Promise<Result<ChatResponse>> {
    const runs = await platform.runsForTicket(ticket.id).catch(() => [] as AgentRun[]);
    const asked = runs.filter((r) => r.id !== c.runId && r.steps?.some((x) => x.step === "Ask for photos" && x.detail.includes(`#${order.id}`))).length;
    const item = order.items.length === 1 ? order.items[0]!.name : `items in order #${order.id}`;
    const first = c.customerName.split(" ")[0];
    const reply =
      asked === 0
        ? `Sorry about the ${item}, ${first}. Before I can sort out a refund I need to see the damage: please add 1–3 photos of the item and the shipping label with the button below.`
        : asked === 1
          ? `I still need a photo before I can refund order #${order.id}. Tap "Add photos" below and send 1–3 pictures of the damage and the shipping label.`
          : `I can't refund order #${order.id} without a photo of the damage, so ticket #${ticket.id} stays open for you. Add photos here whenever you can and I'll pick it up straight away.`;
    const ask: ChatQuestion = {
      kind: "photos",
      prompt: "Add photos of the damage",
      description: "1–3 photos: the damaged item and the shipping label. JPEG or PNG, up to 5 MB each.",
      choices: [],
      original: triage.intent === "damaged_item" ? c.message.split("\n(")[0]! : c.message,
      photos: { min: 1, max: 3, order_id: order.id, hint: why },
    };
    await api.addComment(ticket.id, { body: reply, public: true });
    await api.addComment(ticket.id, { public: false, body: `Waiting for photos (${asked === 0 ? "asked" : asked === 1 ? "reminded once" : "no photo after a reminder: no refund until one arrives"}): ${why}.` });
    const now = await api.ticket(ticket.id);
    await api.updateTicket(ticket.id, { status: "pending", tags: [...new Set([...now.tags, AWAITING_PHOTOS])] });
    await platform.updateRun(c.runId, { ticket_id: ticket.id, status: "resolved", reply });
    await stepper(c.runId)("main", {
      step: asked >= 2 ? "Wait for photos" : "Ask for photos",
      tool: c.channel,
      result: asked >= 2 ? "blocked" : "success",
      detail: `#${order.id}: ${why}${asked === 1 ? " (reminder)" : asked >= 2 ? "; no refund without one, ticket waits on the customer" : ""}`,
    });
    return { status: 200, body: { reply, ticket_id: ticket.id, ask } };
  }

  /** The support playbook is off: Aria doesn't work the request. The owner gets it on a ticket and the customer is told. */
  async function playbookOff(c: Chat, known: Ticket | null): Promise<Result<ChatResponse>> {
    const { ticket } = await ticketFor(known, c);
    const assignee = SUPPORT_AGENTS[0];
    await api.addComment(ticket.id, { public: false, body: `The support playbook is off in the ResolveAI Control Room, so Aria didn't work this message. Over to ${assignee}.` });
    await api.updateTicket(ticket.id, { assignee, status: "open", handled_by: "human", tags: [...new Set([...ticket.tags, "playbook-off"])] });
    const reply = `Thanks, ${c.customerName.split(" ")[0]}. I've passed this to ${OWNER.first} from our team (ticket #${ticket.id}), who will reply here${c.schedule.inHours ? " shortly" : ` when we're back ${c.schedule.back ?? "in the morning"} (IST)`}.`;
    await api.addComment(ticket.id, { body: reply, public: true });
    await platform.updateRun(c.runId, { ticket_id: ticket.id, handled_by: "human", status: "escalated", reply, plan: ["Support playbook is off: hand to the owner"] });
    await stepper(c.runId)("main", { step: "Hand to team", tool: "Zendesk", result: "escalated", detail: `Support playbook off: #${ticket.id} assigned to ${assignee}, no agent ran` });
    return { status: 200, body: { reply, ticket_id: ticket.id } };
  }

  /** Low, medium or high with a ticket: that level's agent works it with its own tools. */
  async function work(c: Chat, ticket: Ticket, isNew: boolean, triage: Triage, crit: Criticality, refundLimit: number, orderIds: number[], order: Order | null): Promise<Result<ChatResponse>> {
    const level = crit.handled_by as "low" | "medium" | "high";
    const damage = triage.intent === "damaged_item";
    const photos = damage ? (await api.ticketAttachments(ticket.id).catch(() => [])).length : 0;
    const prompt = [
      `[Zendesk ticket #${ticket.id}${isNew ? " (new)" : ""} · customer ${c.customerName} (id ${c.customerId}) · today ${today()}]`,
      `Level: ${LEVEL_LABEL[crit.level]} (${crit.reasons.join("; ")})`,
      `Auto-refund limit: ${rupees(refundLimit)}`,
      modeLine(c.schedule),
      damage ? `Damage claim${order ? ` on order #${order.id}` : ""}: ${photos} photo${photos === 1 ? "" : "s"} on the ticket. Call check_damage_claim before any refund or approval.` : null,
      `Orders the customer named (the only ones you may refund): ${orderIds.length ? orderIds.map((id) => `#${id}`).join(", ") : "none yet: ask which order before refunding"}`,
      ...earlierLines(c),
      `Main agent's plan:\n${triage.plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
      `Customer message: ${c.message}`,
    ].filter(Boolean).join("\n");

    const ctx: SupportRun = { ticketId: ticket.id, customerId: c.customerId, runId: c.runId, agent: level, orderIds, intent: triage.intent, claim: c.message };
    let reply: string;
    try {
      const res = await levels[level].generateText(prompt, {
        userId: `customer-${c.customerId}`,
        conversationId: c.sessionId,
        context: runContext(ctx),
      });
      reply = res.text.trim();
      if (!reply) throw new Error("the model returned an empty reply");
    } catch (e) {
      log.error(`[agent] ${level} agent failed on ticket #${ticket.id}:`, e);
      return handOver(c, ticket, `the ${level} agent failed (${errorText(e)})`, true);
    }

    await api.addComment(ticket.id, { body: reply, public: true });
    const [after, run] = await Promise.all([api.ticket(ticket.id), platform.run(c.runId)]);
    const escalated = !!after.assignee && after.assignee !== BOT;
    const solved = after.status === "solved";
    // Not solved, escalated or waiting for approval: the agent answered and the next move is the customer's (it asked
    // for a detail). The run is finished, so it must not stay "working"; the ticket waits on the customer.
    const waitsOnCustomer = !solved && !escalated && run.status !== "waiting_approval";
    if (waitsOnCustomer && after.status !== "pending") await api.updateTicket(ticket.id, { status: "pending" });
    const status = run.status === "waiting_approval" ? "waiting_approval" : escalated ? "escalated" : "resolved";
    await platform.updateRun(c.runId, { status, reply, ...(escalated && { handled_by: "human" }) });
    if (solved || escalated) {
      await remember(c.runId, { ticketId: ticket.id, customerId: c.customerId, intent: triage.intent, level: crit.level, handledBy: escalated ? "human" : level, problem: triage.summary, resolution: reply, outcome: solved ? "resolved" : "escalated" });
    }
    // The checks found no photo where one is needed (e.g. a photo was removed): the chat shows the upload card.
    if (ctx.damage?.decision === "needs_photos" && order) {
      const t = await api.ticket(ticket.id);
      await api.updateTicket(ticket.id, { tags: [...new Set([...t.tags, AWAITING_PHOTOS])] });
      const ask: ChatQuestion = { kind: "photos", prompt: "Add photos of the damage", description: "1–3 photos: the damaged item and the shipping label. JPEG or PNG, up to 5 MB each.", choices: [], original: c.message, photos: { min: 1, max: 3, order_id: order.id, hint: ctx.damage.reasons[0] ?? "" } };
      return { status: 200, body: { reply, ticket_id: ticket.id, ask } };
    }
    return { status: 200, body: { reply, ticket_id: ticket.id } };
  }

  /** "Any update?": answer from the ticket, its latest run and any pending approval. */
  async function statusUpdate(runId: number, ticket: Ticket, message: string, triage: Triage, fromOtherChat: boolean): Promise<Result<ChatResponse>> {
    await addCustomerMessage(ticket, message);
    const [runs, approval] = await Promise.all([platform.runsForTicket(ticket.id).catch(() => []), platform.pendingApprovalFor(ticket.id).catch(() => undefined)]);
    const last = runs.find((r) => r.id !== runId && r.kind === "request");
    const lastReply = [...ticket.comments].reverse().find((x) => x.public && x.author_type !== "customer");
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

  /**
   * We need to know which order before anything can be done. Nothing is opened in Zendesk yet: the customer
   * picks from their orders in the chat, and the answer comes back with the original message.
   */
  async function askWhichOrder(c: Chat, known: Ticket | null, triage: Triage, choices: Order[]): Promise<Result<ChatResponse>> {
    const perItem = triage.intent === "damaged_item";
    const ask: ChatQuestion = {
      kind: "order",
      prompt: perItem ? "Which item is it about?" : "Which order is this about?",
      description: perItem ? "Pick the product, so we look at the right order." : "Pick the order, so we look at the right one.",
      choices: choices.slice(0, 6).flatMap((o) =>
        (perItem ? o.items : [o.items[0]!]).filter(Boolean).map((i) => ({
          value: String(o.id),
          label: perItem || o.items.length === 1 ? i.name : `${i.name} + ${o.items.length - 1} more`,
          description: [`Order #${o.id}`, ORDER_STATUS_LABEL[o.status] ?? o.status, PAYMENT_NOTE[o.payment_status], rupees(perItem ? i.price * i.qty : o.amount)].filter(Boolean).join(" · "),
          image: i.image,
        })),
      ),
      other: { label: "A different order", placeholder: "Order number, e.g. 1047" },
      original: c.message,
    };
    const reply = perItem ? "Sorry to hear that. Which item arrived damaged?" : "Sure, I can help with that. Which order is it about?";
    if (known) {
      await addCustomerMessage(known, c.message);
      await api.addComment(known.id, { body: reply, public: true });
    }
    await platform.updateRun(c.runId, { ticket_id: known?.id ?? null, intent: triage.intent, status: "resolved", reply, plan: ["Ask the customer which order, then work the request"] });
    await stepper(c.runId)("main", { step: "Ask which order", tool: c.channel, result: "success", detail: `${ask.choices.length} options shown; the customer didn't say which order (${triage.summary})` });
    return { status: 200, body: { reply, ask, ...(known && { ticket_id: known.id }) } };
  }

  /** Not a ShopKart matter: answer politely. No ticket is opened; an existing chat ticket just gets the exchange. */
  async function outOfScope(c: Chat, known: Ticket | null, triage: Triage): Promise<Result<ChatResponse>> {
    const reply = "Sorry, I can only help with ShopKart orders, deliveries, refunds and payments. Is there anything about an order I can help you with?";
    if (known) {
      await addCustomerMessage(known, c.message);
      await api.addComment(known.id, { body: reply, public: true });
    }
    await platform.updateRun(c.runId, { ticket_id: known?.id ?? null, intent: triage.intent, status: "resolved", reply, plan: ["Not a ShopKart request: reply politely, no ticket"] });
    await stepper(c.runId)("main", { step: "Out of scope", tool: "Aria LLM", result: "success", detail: `${triage.summary} (no ticket opened)` });
    return { status: 200, body: { reply, ...(known && { ticket_id: known.id }) } };
  }

  /**
   * We don't have the data to answer (no orders, no earlier request): the ticket goes to the support team
   * with a note saying what's missing, and the customer is told the team is on it.
   */
  async function toTeam(c: Chat, known: Ticket | null, triage: Triage, why: string): Promise<Result<ChatResponse>> {
    const { ticket } = await ticketFor(known, c);
    // Missing details a short phone call can collect: Aria · Support Caller rings the customer, and their answers
    // come back to /intake (sarvam_voice) in this session. The API records the step. Any refusal → the hand-over below.
    const ask = detailsToAsk(why);
    if (ask) {
      const placed = await api
        .placeSupportCall({ customer_id: c.customerId, ticket_id: ticket.id, session_id: c.sessionId, run_id: c.runId, reason: ask.reason, questions: ask.questions })
        .catch((e) => (log.warn(`[agent] support call for run ${c.runId} not placed: ${errorText(e)}`), null));
      if (placed) {
        const reply = "I need a couple more details to sort this out, so I'm calling you now on your registered number. It'll take a minute, and I'll continue here right after.";
        await api.addComment(ticket.id, { body: reply, public: true });
        await platform.updateRun(c.runId, { ticket_id: ticket.id, intent: triage.intent, handled_by: "low", status: "working", reply, plan: ["Phone the customer for the missing details", "Continue the request with their answers"] });
        return { status: 200, body: { reply, ticket_id: ticket.id } };
      }
    }
    const assignee = SUPPORT_AGENTS[0];
    await api.addComment(ticket.id, { public: false, body: `Handed to ${assignee} by ResolveAI: the customer ${why}.\nWhat they said: ${triage.summary}\nPlease check with the customer and follow up on this ticket.` });
    await api.updateTicket(ticket.id, { assignee, status: "open", priority: "normal", handled_by: "human", tags: [...new Set([...ticket.tags, triage.intent, "needs-data"])] });
    const reply = `I couldn't find what I need to sort this out myself, so I've passed it to our support team (ticket #${ticket.id}). ${c.schedule.inHours ? "They're looking into it and will get back to you here shortly." : `They're offline right now and will get back to you here when they're back ${c.schedule.back ?? "in the morning"} (IST).`}`;
    await api.addComment(ticket.id, { body: reply, public: true });
    await platform.updateRun(c.runId, { ticket_id: ticket.id, intent: triage.intent, handled_by: "human", status: "escalated", reply, plan: ["No data to answer from", `Hand to ${assignee}`, "Tell the customer the team is on it"] });
    await stepper(c.runId)("main", { step: "Hand to team", tool: "Zendesk", result: "escalated", detail: `No data: the customer ${why}. Assigned to ${assignee}` });
    return { status: 200, body: { reply, ticket_id: ticket.id } };
  }

  /** When a model fails: the ticket goes to a person and the customer still gets an answer. */
  async function handOver(c: Chat, known: Ticket | null, why: string, alreadyAttached = false): Promise<Result<ChatResponse>> {
    const ticket = alreadyAttached && known ? known : (await ticketFor(known, c)).ticket;
    await api.addComment(ticket.id, { public: false, body: `Aria couldn't handle this message: ${why}. Needs a person.` });
    await api.updateTicket(ticket.id, { assignee: null, status: "open", handled_by: "human" });
    const reply = `Thanks for reaching out. I've logged this as ticket #${ticket.id} and a teammate will get back to you shortly.`;
    await api.addComment(ticket.id, { body: reply, public: true });
    await platform.updateRun(c.runId, { ticket_id: ticket.id, handled_by: "human", status: "failed", reply });
    await stepper(c.runId)("main", { step: "Hand over", tool: "Zendesk", result: "blocked", detail: why });
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
          reply = `Your refund was approved, but I couldn't start it automatically. ${OWNER.first} from our team will complete it and update you here (ticket #${ticket.id}).`;
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
      // The sales playbook is off in the Control Room: the CRM records exist, the sales agent doesn't act.
      if (!(await platform.settings()).playbooks.sales) {
        await api.addDealNote(deal.id, {
          type: "note",
          body: `New lead from the business enquiry form. Budget ${rupees(b.budget)}, wants to start: ${b.start_when || "not given"}. The sales playbook is off in the ResolveAI Control Room, so Aria didn't score it or book a call: needs ${OWNER.first}.`,
        });
        return { status: 201, body: { ok: true, message: `Thanks! ${OWNER.first} from our team will contact you shortly.`, deal_id: deal.id } };
      }
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

/** A bare order number in a free-text answer ("1047", "#1047", "order 1047"). */
function mentionedNumber(text: string): number | null {
  const m = text.match(/#?\s*(\d{3,})/);
  return m ? Number(m[1]) : null;
}

/** Requests that can't be worked without knowing the order. */
const ASK_INTENTS: readonly Triage["intent"][] = [...ORDER_INTENTS, "payment_failed"];
/** Money changes hands: never act on an order the customer didn't name (unless it's their only order). */
const MONEY_INTENTS: readonly Triage["intent"][] = ["damaged_item", "refund", "cancel_order"];
const ORDER_STATUS_LABEL: Record<string, string> = { placed: "Placed", shipped: "Shipped", delivered: "Delivered", damaged: "Delivered damaged" };
const PAYMENT_NOTE: Record<string, string | undefined> = { refunded: "Refunded", refund_initiated: "Refund started", failed_debited: "Payment failed" };

/** The customer's orders this kind of request can be about, newest first; empty when none fit. */
function candidateOrders(intent: Triage["intent"], orders: Order[]): Order[] {
  const unsettled = (o: Order) => o.payment_status !== "refunded" && o.payment_status !== "refund_initiated";
  const fits: Partial<Record<Triage["intent"], (o: Order) => boolean>> = {
    order_tracking: (o) => o.status === "placed" || o.status === "shipped",
    damaged_item: (o) => (o.status === "delivered" || o.status === "damaged") && unsettled(o),
    refund: unsettled,
    cancel_order: (o) => (o.status === "placed" || o.status === "shipped") && unsettled(o),
    address_change: (o) => o.status === "placed",
    payment_failed: (o) => o.payment_status === "failed_debited",
  };
  const fit = fits[intent];
  return orders.filter((o) => !fit || fit(o)).sort((a, b) => b.placed_at.localeCompare(a.placed_at));
}

/** The request an answer belongs to ("which order?", or photos for a claim), as one message the agents can work. */
const answerMessage = (a: ChatAnswer) =>
  a.kind === "photos"
    ? `${a.original}\n(Sent photos of order ${a.value && /^\d+$/.test(a.value) ? `#${a.value}` : "?"}: ${a.text})`
    : `${a.original}\n(About order ${a.value && /^\d+$/.test(a.value) ? `#${a.value}` : "?"}: ${a.text})`;

/** Tag on a ticket whose damage claim waits for the customer's photos. */
const AWAITING_PHOTOS = "awaiting-photos";

/** What the customer has really paid ShopKart (₹): paid orders, delivered cash-on-delivery ones, nothing refunded. */
function lifetimeSpend(orders: Order[]): number {
  return orders.filter((o) => o.payment_status === "paid" || (o.payment_status === "cod" && (o.status === "delivered" || o.status === "damaged"))).reduce((a, o) => a + o.amount, 0);
}

/** What to collect by phone when the request can't be worked from the data. null: no call (straight to a person). */
function detailsToAsk(why: string): { reason: string; questions: string[] } | null {
  if (/isn't on their account/.test(why)) return { reason: `${why.replace(/^asked/, "the customer asked")}, so support needs the right order before it can help`, questions: ["the correct order number, from the order confirmation or the My Orders page", "what the request is about and what went wrong", "what the customer would like done"] };
  if (/no orders on this account/.test(why)) return { reason: "the customer asked about an order, but no order shows on their ShopKart account", questions: ["the order number, or the phone number or email used to place the order", "what the request is about"] };
  if (/no earlier request/.test(why)) return { reason: "the customer asked for an update, but support found no earlier request from them", questions: ["which request or order they mean", "what they asked about earlier"] };
  return null;
}

/** The order a ticket is about: the agent writes subjects like "Damaged item, refund requested – order #1023". */
const ticketOrderId = (t: Ticket) => t.order_id ?? (Number(t.subject.match(/order #(\d+)/i)?.[1]) || null);

/** A message about the same problem as a (solved) ticket: same intent, and the same order if one is named. */
function sameIssue(t: Ticket, triage: Triage, named: Order[]): boolean {
  if (!t.tags.includes(triage.intent)) return false;
  const tid = ticketOrderId(t);
  return !named.length || !tid || named.some((o) => o.id === tid);
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

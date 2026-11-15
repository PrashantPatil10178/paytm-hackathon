/**
 * POST /chat, /lead, /analysis and /campaigns/sync. The parts that must always happen are plain code
 * (one ticket per chat session, a contact + deal per enquiry, the reply posted on the ticket, the queue
 * of campaign responses); the decisions in between are made by the VoltAgent agents through their
 * tools. If the model fails, the customer still gets an answer and the ticket or deal is left for a
 * person; a campaign response the agent couldn't decide stays new for the next run.
 */
import {
  BOT,
  ENQUIRY_NEEDS,
  rupees,
  type AnalysisResponse,
  type CampaignResponse,
  type ChatResponse,
  type LeadResponse,
  type LeadSyncResponse,
  type LeadSyncResult,
} from "@ph/shared";
import type { Agent, Memory } from "@voltagent/core";
import { z } from "zod";
import { DemoAPIError, type DemoAPI, type KnownContact } from "./demo-api.ts";
import { analysisNote, analysisThread, personKey } from "./memory.ts";
import { memorySessions, type SessionStore } from "./sessions.ts";
import { runContext, type AnalysisRun, type LeadsRun } from "./tools/context.ts";

const ChatBody = z.object({
  session_id: z.string().min(1),
  customer_id: z.coerce.number().int().positive(),
  message: z.string().trim().min(1),
  /** "voice" = spoken on the phone line (Sarvam): the ticket is via voice and the reply is read aloud. */
  channel: z.enum(["chat", "voice"]).default("chat"),
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

export interface ServiceDeps {
  api: DemoAPI;
  support: Agent;
  sales: Agent;
  analysis: Agent;
  leads: Agent;
  /** Chat session → ticket. Postgres in the app, in memory in tests. */
  sessions?: SessionStore;
  /** The analysis agent's memory (with working memory), where the note about the last report is kept. */
  analysisMemory?: Memory;
  log?: Pick<Console, "warn" | "error">;
}

export function createService({ api, support, sales, analysis, leads, sessions = memorySessions(), analysisMemory, log = console }: ServiceDeps) {

  async function ticketFor(sessionId: string, customerId: number, message: string, channel: "chat" | "voice" = "chat"): Promise<{ id: number; customer: string; isNew: boolean }> {
    const known = await sessions.get(sessionId);
    if (known) {
      try {
        const t = await api.ticket(known.ticketId);
        if (t.created_at !== known.ticketCreatedAt) throw new DemoAPIError(404, "ticket was replaced by a reset");
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
      via: channel,
      status: "open",
      assignee: BOT,
      tags: [channel],
    });
    await sessions.set(sessionId, { ticketId: t.id, ticketCreatedAt: t.created_at });
    return { id: t.id, customer: t.requester.name, isNew: true };
  }

  /** The request forms the team switched on, one line each for the prompt. None if the API can't say. */
  async function activeForms(): Promise<string[]> {
    try {
      const { forms } = await api.infoForms();
      return forms
        .filter((f) => f.active)
        .map((f) => `- ${f.id}: "${f.title}", asks for ${f.fields.filter((x) => x.enabled).map((x) => x.label.replace(/\?$/, "").toLowerCase()).join(", ")}. Use for: ${f.use_for}`);
    } catch (e) {
      log.warn(`[agent] couldn't load the request forms: ${errorText(e)}`);
      return [];
    }
  }

  async function chat(raw: unknown): Promise<Result<ChatResponse>> {
    const parsed = ChatBody.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error);
    const { session_id, customer_id, message, channel } = parsed.data;

    return guard(async () => {
      const [ticket, forms] = await Promise.all([ticketFor(session_id, customer_id, message, channel), channel === "chat" ? activeForms() : []]);
      const via = channel === "voice" ? " · phone call: your reply is spoken aloud" : "";
      const formList = forms.length ? `\nForms you can send with request_details:\n${forms.join("\n")}` : "";
      const prompt = `[Zendesk ticket #${ticket.id}${ticket.isNew ? " (new)" : ""} · customer ${ticket.customer} (id ${customer_id})${via} · today ${today()}${formList}]\n${message}`;

      let reply: string;
      try {
        const res = await support.generateText(prompt, {
          userId: `customer-${customer_id}`,
          conversationId: session_id,
          context: runContext({ ticketId: ticket.id, customerId: customer_id, channel }),
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
        for (const r of mine) out.push(await work(r));
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
  async function work(r: CampaignResponse): Promise<LeadSyncResult> {
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

  return { chat, lead, analyze, syncLeads };
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

/**
 * Tools for the leads agent. Each run works on one campaign response, taken from the run context.
 * The deal amount is the budget the person gave (never a model guess), and a response can be decided
 * once: the API refuses to convert or skip it a second time.
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import type { DemoAPI } from "../demo-api.ts";
import { runOf, type LeadsRun } from "./context.ts";

export function leadsTools(api: DemoAPI) {
  const createLead = createTool({
    name: "create_lead",
    description:
      "Turn this campaign response into a CRM lead: a contact (an existing one with the same email is reused) and a deal in the New lead column. " +
      "The deal amount is set from their stated budget. Shows up live on the HubSpot board.",
    parameters: z.object({
      score: z.enum(["hot", "warm", "cold"]),
      deal_name: z.string().min(1).max(80).describe("'<Company> – <need>', e.g. 'Joshi Sweets – Bulk order'"),
      next_step: z.string().min(1).max(80).describe("Short, e.g. 'Book a call this week'"),
      note: z.string().min(1).max(400).describe("1–2 sentences for the sales team: the need, budget, timing and why this score"),
    }),
    execute: async ({ score, deal_name, next_step, note }, opts) => {
      const run = runOf<LeadsRun>(opts);
      if (run.outcome) return { ok: false, error: `This response was already ${run.outcome.outcome}.` };
      const res = await api.convertResponse(run.responseId, { score, deal_name, next_step, note, amount: run.budget });
      run.outcome = { outcome: "converted", dealId: res.deal.id, score, reason: note };
      return { ok: true, deal_id: res.deal.id, contact_id: res.contact.id, reused_existing_contact: res.existing_contact };
    },
  });

  const skipResponse = createTool({
    name: "skip_response",
    description: "Set this response aside without creating a lead: spam, a test entry, no business need, or already in the pipeline.",
    parameters: z.object({ reason: z.string().min(1).max(200).describe("Short, shown to the team, e.g. 'Spam: prize message with a link'") }),
    execute: async ({ reason }, opts) => {
      const run = runOf<LeadsRun>(opts);
      if (run.outcome) return { ok: false, error: `This response was already ${run.outcome.outcome}.` };
      await api.skipResponse(run.responseId, { reason });
      run.outcome = { outcome: "skipped", reason };
      return { ok: true };
    },
  });

  return [createLead, skipResponse];
}

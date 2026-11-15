/** Tools for the sales agent. Each one acts on the enquiry's own deal only. */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import type { DemoAPI } from "../demo-api.ts";
import { runOf, type SalesRun } from "./context.ts";

export function salesTools(api: DemoAPI) {
  const updateDeal = createTool({
    name: "update_deal",
    description: "Set the deal's lead score, pipeline stage and next step. Stage changes show up live on the HubSpot board.",
    parameters: z.object({
      score: z.enum(["hot", "warm", "cold"]).optional(),
      stage: z.enum(["new_lead", "qualified", "meeting_booked"]).optional().describe("Later stages are for the sales team"),
      next_step: z.string().max(80).optional().describe("Short, e.g. 'Intro call Tue 11:00'"),
    }),
    execute: async (changes, opts) => {
      const d = await api.updateDeal(runOf<SalesRun>(opts).dealId, changes);
      return { deal_id: d.id, stage: d.stage, score: d.score, next_step: d.next_step };
    },
  });

  const addDealNote = createTool({
    name: "add_deal_note",
    description: "Add a note to the deal's activity timeline for the sales team (why you scored it this way, what was agreed).",
    parameters: z.object({ body: z.string().min(1) }),
    execute: async ({ body }, opts) => {
      await api.addDealNote(runOf<SalesRun>(opts).dealId, { body, type: "note" });
      return { ok: true };
    },
  });

  const getFreeSlots = createTool({
    name: "get_free_slots",
    description: "Free 30-minute call slots with the sales team over the next 3 working days (IST).",
    parameters: z.object({}),
    execute: async () => ({ slots: (await api.slots()).slots.slice(0, 8) }),
  });

  const bookMeeting = createTool({
    name: "book_meeting",
    description: "Book an intro call for this deal in one of the free slots. Use the slot's start exactly as returned.",
    parameters: z.object({ start: z.string().describe("ISO start time from get_free_slots") }),
    execute: async ({ start }, opts) => {
      const m = await api.bookMeeting({ deal_id: runOf<SalesRun>(opts).dealId, start, duration_min: 30 });
      return { ok: true, title: m.title, start: m.start, attendees: m.attendees };
    },
  });

  return [updateDeal, addDealNote, getFreeSlots, bookMeeting];
}

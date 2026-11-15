/**
 * Who solved (or is handling) a ticket, for the Control Room's three buckets:
 * - `human`: a person handled it (the AI escalated it, a person owns or answered it). Wins over everything.
 * - `ai_approved`: Aria did the work, but only after a person approved its action in Approvals.
 * - `ai`: Aria alone.
 * The API's /control-room/stats, /control-room/tickets and /analytics/metrics all use this.
 */
export type TicketSolver = "ai" | "ai_approved" | "human";

export function ticketSolver(t: { withPerson: boolean; approved: boolean }): TicketSolver {
  if (t.withPerson) return "human";
  return t.approved ? "ai_approved" : "ai";
}

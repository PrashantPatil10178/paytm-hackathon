import type { TicketSummary, TicketView } from "@ph/shared";

export const VIEWS: { id: TicketView; label: string }[] = [
  { id: "all_unsolved", label: "All unsolved" },
  { id: "unassigned", label: "Unassigned" },
  { id: "assigned_humans", label: "Assigned to humans" },
  { id: "recently_solved", label: "Recently solved" },
];

export interface ListResponse {
  view: TicketView;
  counts: Record<TicketView, number>;
  tickets: TicketSummary[];
  /** newest tickets across all views, for arrival toasts */
  recent: TicketSummary[];
}

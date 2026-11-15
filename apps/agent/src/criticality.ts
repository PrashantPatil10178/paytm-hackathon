/**
 * The criticality engine. The main agent reads the request (intent, mood, confidence); this code
 * turns that plus hard facts (order amount, payment state, repeat contact) into a level. Rules
 * that involve money or risk live here, not in a prompt, so no message can talk its way past them.
 *
 *   critical → a person (the AI only writes the brief)
 *   high     → the high agent plans it, a person approves before anything happens
 *   medium   → the medium agent acts within limits (refunds up to AUTO_REFUND_LIMIT)
 *   low      → the low agent answers and closes
 */
import type { AgentLevel, HandledBy, Order } from "@ph/shared";

/** Refunds up to this amount need no person. Same limit the refund tool enforces. */
export const AUTO_REFUND_LIMIT = 1000;
/** Below this confidence the main agent's reading isn't trusted: one level up. */
export const MIN_CONFIDENCE = 0.6;

export const INTENTS = [
  "order_tracking",
  "question",
  "damaged_item",
  "refund",
  "cancel_order",
  "address_change",
  "payment_failed",
  "account",
  "complaint",
  "other",
  /** Not about shopping with ShopKart at all (weather, jokes, homework, other companies). Answered politely, no ticket. */
  "out_of_scope",
] as const;
/** Intents that need one of the customer's orders to be answered. */
export const ORDER_INTENTS: readonly Intent[] = ["order_tracking", "damaged_item", "refund", "cancel_order", "address_change"];
export type Intent = (typeof INTENTS)[number];

export interface Signals {
  angry: boolean;
  urgent: boolean;
  /** Mentions fraud, police, consumer court, legal action, chargeback, threats */
  legal_or_fraud: boolean;
  /** Asks for a person */
  wants_human: boolean;
}

export interface CriticalityInput {
  intent: Intent;
  signals: Signals;
  confidence: number;
  order?: Pick<Order, "amount" | "status" | "payment_status"> | null;
  /** This customer's other tickets opened in the last 30 days */
  recentTickets: number;
}

export interface Criticality {
  level: AgentLevel;
  handled_by: HandledBy;
  /** Why, in plain words, in the order the rules applied */
  reasons: string[];
}

const ORDER: AgentLevel[] = ["low", "medium", "high", "critical"];
const up = (l: AgentLevel): AgentLevel => ORDER[Math.min(ORDER.indexOf(l) + 1, ORDER.length - 1)]!;
const atLeast = (l: AgentLevel, min: AgentLevel): AgentLevel => (ORDER.indexOf(l) >= ORDER.indexOf(min) ? l : min);
export const HANDLER: Record<AgentLevel, HandledBy> = { low: "low", medium: "medium", high: "high", critical: "human" };

const rupee = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function assessCriticality(i: CriticalityInput): Criticality {
  const reasons: string[] = [];
  let level: AgentLevel;

  // 1. Hard rules: risk and money.
  if (i.signals.legal_or_fraud) {
    level = "critical";
    reasons.push("mentions fraud or legal action");
  } else if (i.order?.payment_status === "failed_debited" || i.intent === "payment_failed") {
    level = "critical";
    reasons.push(i.order ? `money debited (${rupee(i.order.amount)}) but the payment failed` : "says money was debited but the payment failed");
  } else if ((i.intent === "refund" || i.intent === "damaged_item") && i.order && i.order.amount > AUTO_REFUND_LIMIT) {
    level = "high";
    reasons.push(`refund of ${rupee(i.order.amount)} is above the ${rupee(AUTO_REFUND_LIMIT)} auto-refund limit`);
  } else {
    // 2. The kind of request.
    switch (i.intent) {
      case "order_tracking":
      case "question":
        level = "low";
        reasons.push("information request");
        break;
      case "refund":
      case "damaged_item":
        level = "medium";
        reasons.push(i.order ? `refund of ${rupee(i.order.amount)} is within the auto-refund limit` : "refund request, order to be confirmed");
        break;
      case "cancel_order":
      case "address_change":
        level = "medium";
        reasons.push("changes an order");
        break;
      default:
        level = "medium";
        reasons.push("needs a judgement call");
    }
  }

  // 3. AI signals push it up.
  if (level !== "critical") {
    if (i.signals.angry && i.recentTickets >= 2) {
      level = up(level);
      reasons.push(`upset and contacted us ${i.recentTickets} times recently`);
    }
    if (i.signals.wants_human) {
      level = atLeast(level, "high");
      reasons.push("asked for a person");
    }
    // 4. Low confidence pushes it one level up.
    if (i.confidence < MIN_CONFIDENCE) {
      level = up(level);
      reasons.push(`AI confidence ${Math.round(i.confidence * 100)}% is below ${MIN_CONFIDENCE * 100}%`);
    }
  }

  return { level, handled_by: HANDLER[level], reasons };
}

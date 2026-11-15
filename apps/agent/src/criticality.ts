/**
 * The criticality engine. The main agent reads the request (intent, mood, confidence); this code
 * turns that plus hard facts (order amount, payment state, repeat contact) into a level. Rules
 * that involve money or risk live here, not in a prompt, so no message can talk its way past them.
 *
 *   critical → a person (the AI only writes the brief)
 *   high     → the high agent plans it, a person approves before anything happens
 *   medium   → the medium agent acts within limits (refunds up to the auto-refund limit)
 *   low      → the low agent answers and closes
 */
import type { AgentLevel, HandledBy, Order } from "@ph/shared";

/**
 * Refunds up to the auto-refund limit need no person; the refund tool enforces the same limit. The limit is a
 * Control Room setting (`refundLimit`, read through the platform client); this is the default and the
 * fallback when the setting can't be read.
 */
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
  /** Mentions fraud, a scam, an unauthorised charge or a chargeback */
  fraud: boolean;
  /** Mentions police, consumer court, a lawyer or legal action, or threatens / abuses */
  legal: boolean;
  /** Asks for a person */
  wants_human: boolean;
}

/** The Control Room's "Always escalate to a human when…" switches. Failed payments always go to a person. */
export interface EscalationSwitches {
  fraud: boolean;
  legal: boolean;
  vip: boolean;
  negative: boolean;
}

export const ESCALATE_ALL: EscalationSwitches = { fraud: true, legal: true, vip: false, negative: true };
/** Lifetime spend (paid orders, refunds excluded) from which a customer counts as VIP. */
export const VIP_SPEND = 15_000;

export interface CriticalityInput {
  intent: Intent;
  signals: Signals;
  confidence: number;
  order?: Pick<Order, "amount" | "status" | "payment_status"> | null;
  /** This customer's other tickets opened in the last 30 days */
  recentTickets: number;
  /** ₹ the medium agent may refund alone (Control Room setting). Default AUTO_REFUND_LIMIT. */
  refundLimit?: number;
  /** ₹ up to which a damage claim with a verified photo and no risk signal may be refunded alone (Control Room setting) */
  verifiedDamageLimit?: number;
  /** The Control Room's escalation switches. Default: fraud, legal and negative on, VIP off. */
  escalation?: EscalationSwitches;
  /** The autonomy that applies now (business hours or after hours). suggest: every action waits for a person. */
  autonomy?: "suggest" | "approval" | "autonomous";
  /** The previous message in this chat was upset too */
  upsetBefore?: boolean;
  /** The customer's lifetime spend in ₹ (paid orders, refunds excluded) */
  lifetimeSpend?: number;
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
/** Requests that change something for the customer: in "suggest only" a person approves each one. */
const ACTIONS: readonly Intent[] = ["refund", "damaged_item", "cancel_order", "address_change"];
/** Information only: VIP customers still get these answered by Aria. */
const INFO: readonly Intent[] = ["order_tracking", "question", "out_of_scope"];

export function assessCriticality(i: CriticalityInput): Criticality {
  const reasons: string[] = [];
  const limit = i.refundLimit ?? AUTO_REFUND_LIMIT;
  const damageLimit = Math.max(limit, i.verifiedDamageLimit ?? limit);
  const esc = i.escalation ?? ESCALATE_ALL;
  let level: AgentLevel;

  // 1. Hard rules: risk and money. A switch that is off only stops a mention from forcing a person; the money
  //    rules below (limits, approvals, photo and risk checks in the tools) still apply.
  if (i.signals.legal && esc.legal) {
    level = "critical";
    reasons.push("mentions legal action, police or threats");
  } else if (i.signals.fraud && esc.fraud) {
    level = "critical";
    reasons.push("mentions fraud or a chargeback");
  } else if (i.order?.payment_status === "failed_debited" || i.intent === "payment_failed") {
    level = "critical";
    reasons.push(i.order ? `money debited (${rupee(i.order.amount)}) but the payment failed` : "says money was debited but the payment failed, and no order shows a failed payment");
  } else if ((i.intent === "refund" || i.intent === "damaged_item") && i.order && i.order.amount > limit) {
    if (i.intent === "damaged_item" && i.order.amount <= damageLimit) {
      level = "medium";
      reasons.push(`refund of ${rupee(i.order.amount)} is above the ${rupee(limit)} auto-refund limit, but within ${rupee(damageLimit)} for damage verified by photo`);
    } else {
      level = "high";
      reasons.push(`refund of ${rupee(i.order.amount)} is above the ${rupee(limit)} auto-refund limit`);
    }
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
  if (level !== "critical") {
    if (i.signals.legal) reasons.push("mentions legal action, but the legal-threats switch is off");
    else if (i.signals.fraud) reasons.push("mentions fraud, but the fraud switch is off: refunds still need the usual checks");
  }

  // 3. Control Room switches and AI signals push it up.
  if (level !== "critical") {
    if (esc.vip && (i.lifetimeSpend ?? 0) >= VIP_SPEND && !INFO.includes(i.intent)) {
      level = "critical";
      reasons.push(`VIP customer (${rupee(i.lifetimeSpend!)} spent, VIP from ${rupee(VIP_SPEND)})`);
    } else if (esc.negative && i.signals.angry && i.upsetBefore) {
      level = "critical";
      reasons.push("upset on two messages in a row");
    } else if (esc.negative && i.signals.angry && i.recentTickets >= 2) {
      level = up(level);
      reasons.push(`upset and contacted us ${i.recentTickets} times recently`);
    }
  }
  if (level !== "critical") {
    if (i.autonomy === "suggest" && ACTIONS.includes(i.intent) && level === "medium") {
      level = "high";
      reasons.push("autonomy is Suggest only: a person approves every action");
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

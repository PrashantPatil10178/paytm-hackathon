/**
 * ShopKart's business policies: the rules a real Indian D2C store runs on, written for testing the agents.
 * Product categories match the shop (Audio, Wearables, Cameras, Accessories, Bags, Home, Fashion), and the
 * numbers match how the demo already behaves (₹1,000 AI refund limit, payments escalations answered within 2 hours).
 *
 * Policies are configuration, not demo data: `ensurePolicies` adds any policy or rule that is missing (by code) and
 * never overwrites one that exists, so edits made in the database survive restarts and `bun run reset`.
 */
import type { Policy, PolicyRule } from "@ph/shared";
import { sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import * as s from "./schema.ts";

type PolicySeed = Omit<Policy, "updated_at" | "status" | "effective_from"> & { effective_from: string; rules: RuleSeed[] };
type RuleSeed = Omit<PolicyRule, "policy_code" | "active" | "approver" | "conditions" | "params"> &
  Partial<Pick<PolicyRule, "approver" | "conditions" | "params">>;

const ELECTRONICS = ["Audio", "Wearables", "Cameras"];

export const POLICIES: PolicySeed[] = [
  /* ───── Returns ───── */
  {
    code: "POL-RET",
    area: "returns",
    title: "Returns",
    owner: "Customer Experience",
    version: 4,
    effective_from: "2026-10-01",
    summary: "Return windows depend on the category and start at delivery. Electronics are replaced for defects only. Some items can't be returned.",
    customer_text:
      "Most items can be returned within 10 to 30 days of delivery, depending on the category, if unused and in their original packaging. Headphones, smartwatches and cameras are replaced if faulty within 7 days. Innerwear, personalised items and gift cards can't be returned.",
    rules: [
      { code: "RET-WINDOW-FASHION", title: "Fashion: 30-day returns", description: "Clothing can be returned within 30 days of delivery, unworn, with tags attached.", conditions: { categories: ["Fashion"], reasons: ["change_of_mind", "size_fit", "defective"] }, effect: "allow", params: { window_days: 30, condition: "unworn, tags attached" }, priority: 10 },
      { code: "RET-WINDOW-HOME", title: "Home: 10-day returns", description: "Home items can be returned within 10 days of delivery, unused, in the original packaging.", conditions: { categories: ["Home"] }, effect: "allow", params: { window_days: 10, condition: "unused, original packaging" }, priority: 10 },
      { code: "RET-WINDOW-ACCESSORIES-BAGS", title: "Accessories and bags: 15-day returns", description: "Accessories and bags can be returned within 15 days of delivery, unused, with all tags and dust covers.", conditions: { categories: ["Accessories", "Bags"] }, effect: "allow", params: { window_days: 15, condition: "unused, tags and dust cover" }, priority: 10 },
      { code: "RET-ELECTRONICS-DEFECT-ONLY", title: "Electronics: replacement for defects only", description: "Audio, wearables and cameras can't be returned for change of mind. A defective unit is replaced (refund only if out of stock) when reported within 7 days of delivery.", conditions: { categories: ELECTRONICS, reasons: ["change_of_mind"] }, effect: "deny", params: { defect_window_days: 7, remedy: "replacement" }, priority: 5 },
      { code: "RET-NON-RETURNABLE", title: "Non-returnable items", description: "Innerwear, personalised or engraved items, gift cards and opened personal-care items can't be returned unless they arrive damaged or wrong.", conditions: { tags: ["innerwear", "personalised", "gift_card", "personal_care_opened"], reasons: ["change_of_mind", "size_fit"] }, effect: "deny", priority: 1 },
      { code: "RET-PICKUP-FEE", title: "Return pickup fee", description: "Reverse pickup is free for defective, damaged or wrong items. Change-of-mind returns on orders under ₹499 pay a ₹49 pickup fee, deducted from the refund.", conditions: { reasons: ["change_of_mind"], max_amount: 498 }, effect: "info", params: { fee: 49, free_above: 499 }, priority: 20 },
      { code: "RET-QC", title: "Quality check before refund", description: "Returned items are checked at the warehouse within 48 hours of pickup. If the item fails the check (used, damaged by the customer, parts missing) it is shipped back and not refunded.", effect: "require", params: { qc_hours: 48 }, priority: 30 },
    ],
  },

  /* ───── Refunds ───── */
  {
    code: "POL-REF",
    area: "refunds",
    title: "Refunds and approval limits",
    owner: "Finance",
    version: 5,
    effective_from: "2026-10-01",
    summary: "Who may approve a refund depends on the amount: the AI up to ₹1,000, a team lead up to ₹10,000, finance above that. Money goes back to the original payment method.",
    customer_text:
      "Refunds go back to your original payment method: UPI and Paytm in 1 to 2 working days, net banking in 3 to 5, cards in 5 to 7. Cash on delivery orders are refunded to your Paytm wallet or bank account.",
    rules: [
      { code: "REF-AUTO-AI", title: "AI refunds up to ₹1,000", description: "Aria may refund a delivered or damaged order of up to ₹1,000 without a person, once the item and order are verified.", conditions: { order_status: ["delivered", "damaged"], max_amount: 1000 }, effect: "auto", params: { max_amount: 1000 }, priority: 10 },
      { code: "REF-TEAM-LEAD", title: "₹1,001 to ₹10,000: team lead approval", description: "Refunds from ₹1,001 to ₹10,000 need approval from the support team lead before they are started.", conditions: { min_amount: 1001, max_amount: 10000 }, effect: "approval", approver: "Support team lead", params: { decision_sla_hours: 4 }, priority: 20 },
      { code: "REF-FINANCE", title: "Above ₹10,000: finance approval", description: "Refunds above ₹10,000 need approval from the finance manager, with the evidence attached.", conditions: { min_amount: 10001 }, effect: "approval", approver: "Finance manager", params: { decision_sla_hours: 24, evidence_required: true }, priority: 20 },
      { code: "REF-KEEP-ITEM", title: "Keep the item under ₹500", description: "For damaged or defective items worth up to ₹500 there is no return pickup: the customer keeps or disposes of the item and is refunded.", conditions: { max_amount: 500, reasons: ["damaged_in_transit", "defective"] }, effect: "auto", params: { return_required: false }, priority: 5 },
      { code: "REF-TIMELINE-UPI", title: "UPI and Paytm: 1–2 working days", description: "Refunds to UPI reach the customer in 1 to 2 working days; to the Paytm wallet instantly.", conditions: { payment: ["prepaid"] }, effect: "info", params: { method: "upi", working_days: "1-2", wallet: "instant" }, priority: 50 },
      { code: "REF-TIMELINE-NETBANKING", title: "Net banking: 3–5 working days", description: "Refunds to net banking take 3 to 5 working days.", conditions: { payment: ["prepaid"] }, effect: "info", params: { method: "netbanking", working_days: "3-5" }, priority: 50 },
      { code: "REF-TIMELINE-CARD", title: "Cards: 5–7 working days", description: "Refunds to credit and debit cards take 5 to 7 working days, depending on the bank.", conditions: { payment: ["prepaid"] }, effect: "info", params: { method: "card", working_days: "5-7" }, priority: 50 },
      { code: "REF-COD", title: "Cash on delivery refunds", description: "COD orders are refunded to the Paytm wallet (instant) or to a verified bank account by NEFT in 3 to 5 working days. Never in cash.", conditions: { payment: ["cod"] }, effect: "require", params: { options: ["paytm_wallet", "bank_neft"], working_days: "3-5", needs: "verified bank details for NEFT" }, priority: 40 },
      { code: "REF-PARTIAL", title: "Partial refunds per item", description: "Refunds are per line item: one item of a multi-item order can be refunded alone. Each item is refunded at most once.", effect: "allow", params: { max_refunds_per_item: 1 }, priority: 60 },
    ],
  },

  /* ───── Damaged, defective and wrong items ───── */
  {
    code: "POL-DMG",
    area: "damaged_items",
    title: "Damaged, defective and wrong items",
    owner: "Customer Experience",
    version: 3,
    effective_from: "2026-09-15",
    summary: "Report within 48 hours of delivery (7 days for hidden electronics faults). Photos above ₹1,000, an unboxing video above ₹5,000. Replace first, refund if out of stock.",
    customer_text:
      "If something arrives damaged, faulty or wrong, tell us within 48 hours of delivery and we'll replace it, or refund you if it's out of stock. For orders above ₹1,000 we'll ask for a photo.",
    rules: [
      { code: "DMG-REPORT-WINDOW", title: "Report within 48 hours", description: "Transit damage and wrong items must be reported within 48 hours of delivery. Hidden faults in electronics (that only show in use) can be reported within 7 days.", effect: "require", params: { report_hours: 48, hidden_fault_days: 7, hidden_fault_categories: ELECTRONICS }, priority: 10 },
      { code: "DMG-PHOTO", title: "Photo above ₹1,000", description: "Claims on items above ₹1,000 need at least one photo of the damage and the shipping label.", conditions: { min_amount: 1001 }, effect: "require", params: { evidence: "photo of item and shipping label" }, priority: 20 },
      { code: "DMG-UNBOXING-VIDEO", title: "Unboxing video above ₹5,000", description: "Damage or missing-item claims on cameras and wearables above ₹5,000 need an unboxing video.", conditions: { categories: ["Cameras", "Wearables"], min_amount: 5001 }, effect: "require", params: { evidence: "unboxing video" }, priority: 15 },
      { code: "DMG-REMEDY", title: "Replace first, refund if out of stock", description: "A damaged or defective item is replaced at no cost. If it is out of stock, or the customer declines a replacement, it is refunded.", conditions: { reasons: ["damaged_in_transit", "defective"] }, effect: "allow", params: { first: "replacement", fallback: "refund" }, priority: 30 },
      { code: "DMG-WRONG-ITEM", title: "Wrong item delivered", description: "A wrong item is picked up free, and the customer chooses the right item or a refund.", conditions: { reasons: ["wrong_item"] }, effect: "allow", params: { pickup_fee: 0, customer_choice: ["replacement", "refund"] }, priority: 30 },
      { code: "DMG-REPEAT", title: "Second damaged delivery goes to a person", description: "If the replacement also arrives damaged, the case goes to a support person, who may add goodwill credit.", effect: "escalate", approver: "Support team", priority: 40 },
    ],
  },

  /* ───── Cancellations ───── */
  {
    code: "POL-CAN",
    area: "cancellations",
    title: "Cancellations",
    owner: "Operations",
    version: 2,
    effective_from: "2026-08-01",
    summary: "Free until the order ships. After that the customer refuses delivery or returns it. COD until out for delivery. Personalised items lock after processing starts.",
    customer_text: "You can cancel free of charge until your order ships, and get a full refund. Once it has shipped, you can refuse the delivery or return it after it arrives.",
    rules: [
      { code: "CAN-BEFORE-SHIP", title: "Free cancellation before shipping", description: "Orders that haven't shipped can be cancelled at no cost, with a full refund to the original payment method.", conditions: { order_status: ["placed"] }, effect: "auto", params: { fee: 0, refund: "full, to source" }, priority: 10 },
      { code: "CAN-AFTER-SHIP", title: "No cancellation after shipping", description: "Shipped orders can't be cancelled. The customer can refuse delivery (prepaid: refunded after it returns to the warehouse) or return it under the returns policy.", conditions: { order_status: ["shipped"] }, effect: "deny", params: { alternatives: ["refuse_delivery", "return_after_delivery"] }, priority: 10 },
      { code: "CAN-COD", title: "COD: cancel until out for delivery", description: "Cash on delivery orders can be cancelled until they are out for delivery.", conditions: { payment: ["cod"] }, effect: "allow", params: { until: "out_for_delivery" }, priority: 20 },
      { code: "CAN-PERSONALISED", title: "Personalised items: 2-hour window", description: "Personalised or engraved items can be cancelled only within 2 hours of ordering, before production starts.", conditions: { tags: ["personalised"] }, effect: "deny", params: { cancel_window_hours: 2 }, priority: 5 },
    ],
  },

  /* ───── Shipping and delivery ───── */
  {
    code: "POL-SHP",
    area: "shipping",
    title: "Shipping and delivery",
    owner: "Operations",
    version: 3,
    effective_from: "2026-09-01",
    summary: "Dispatch within 24 hours. Delivery 2–4 days in metros, 4–7 elsewhere. Free shipping from ₹499. ₹100 credit if more than 3 days late. Lost after 7 days without a tracking update.",
    customer_text:
      "Orders ship within 24 hours and arrive in 2 to 4 working days in metro cities, 4 to 7 elsewhere. Shipping is free on orders of ₹499 or more. If we're more than 3 days late, we'll add ₹100 store credit to your account.",
    rules: [
      { code: "SHP-DISPATCH", title: "Dispatch within 24 hours", description: "Orders placed before 6 pm ship the same working day; later orders the next working day.", effect: "info", params: { dispatch_hours: 24, cutoff: "18:00 IST" }, priority: 10 },
      { code: "SHP-ETA", title: "Delivery estimates", description: "Delivery takes 2 to 4 working days in metro cities, 4 to 7 in other cities and 7 to 10 in remote pincodes.", effect: "info", params: { metro_days: "2-4", other_days: "4-7", remote_days: "7-10" }, priority: 10 },
      { code: "SHP-FEES", title: "Shipping fees", description: "Free standard shipping on orders of ₹499 or more; ₹49 below. Express delivery in metros costs ₹99.", effect: "info", params: { free_from: 499, standard_fee: 49, express_fee: 99, express: "metro only" }, priority: 20 },
      { code: "SHP-DELAY-CREDIT", title: "Late delivery credit", description: "If delivery is more than 3 days past the promised date, the customer gets ₹100 store credit, once per order. Aria may add it without a person.", effect: "auto", params: { late_days: 3, credit: 100, per_order: 1 }, priority: 30 },
      { code: "SHP-ATTEMPTS", title: "Three delivery attempts", description: "The courier tries 3 times. After that the parcel returns to the warehouse; prepaid orders are refunded minus shipping.", effect: "info", params: { attempts: 3, prepaid_refund: "minus shipping" }, priority: 40 },
      { code: "SHP-LOST", title: "Lost shipments", description: "A shipment with no tracking update for 7 days is treated as lost: logistics is asked to trace it, and the customer is offered a reship or a full refund.", effect: "escalate", approver: "Logistics team", params: { no_update_days: 7, remedy: ["reship", "full_refund"] }, priority: 40 },
    ],
  },

  /* ───── Payments ───── */
  {
    code: "POL-PAY",
    area: "payments",
    title: "Payment problems",
    owner: "Payments",
    version: 4,
    effective_from: "2026-10-01",
    summary: "Money debited but the order failed: banks reverse it in 5–7 working days. Above ₹5,000, or after 7 days, the payments team reconciles it and answers within 2 hours.",
    customer_text:
      "If money left your account but the order didn't go through, your bank reverses it automatically within 5 to 7 working days. For larger amounts our payments team checks it straight away and gets back to you within 2 hours.",
    rules: [
      { code: "PAY-FAILED-SMALL", title: "Failed payment up to ₹5,000", description: "Debited but not confirmed, up to ₹5,000: explain the automatic bank reversal (5–7 working days) and keep the ticket open until it lands.", conditions: { max_amount: 5000 }, effect: "info", params: { auto_reversal_working_days: "5-7" }, priority: 10 },
      { code: "PAY-FAILED-LARGE", title: "Failed payment above ₹5,000", description: "Debited but not confirmed, above ₹5,000: hand to the payments team for a manual reconcile; they reply within 2 hours.", conditions: { min_amount: 5001 }, effect: "escalate", approver: "Payments team", params: { reply_sla_hours: 2 }, priority: 10 },
      { code: "PAY-FAILED-OVERDUE", title: "Reversal overdue", description: "If an automatic reversal hasn't arrived after 7 working days, the payments team raises it with the gateway.", effect: "escalate", approver: "Payments team", params: { after_working_days: 7 }, priority: 20 },
      { code: "PAY-DOUBLE-CHARGE", title: "Charged twice", description: "A duplicate charge is refunded within 48 hours once the payments team confirms it in the gateway report.", effect: "escalate", approver: "Payments team", params: { refund_within_hours: 48 }, priority: 20 },
    ],
  },

  /* ───── Cash on delivery ───── */
  {
    code: "POL-COD",
    area: "cod",
    title: "Cash on delivery",
    owner: "Risk",
    version: 2,
    effective_from: "2026-07-01",
    summary: "COD up to ₹10,000 per order, ₹29 fee below ₹999. Turned off for customers who refused 2 COD deliveries in 90 days.",
    customer_text: "Cash on delivery is available on orders up to ₹10,000. A ₹29 handling fee applies to orders under ₹999.",
    rules: [
      { code: "COD-LIMIT", title: "COD up to ₹10,000", description: "COD can't be used for orders above ₹10,000.", conditions: { payment: ["cod"], min_amount: 10001 }, effect: "deny", params: { max_order: 10000 }, priority: 10 },
      { code: "COD-FEE", title: "COD handling fee", description: "₹29 handling fee on COD orders under ₹999.", conditions: { payment: ["cod"], max_amount: 998 }, effect: "info", params: { fee: 29, waived_from: 999 }, priority: 20 },
      { code: "COD-BLOCK", title: "COD off after refused deliveries", description: "Customers who refused 2 or more COD deliveries in the last 90 days can only pay online.", conditions: { payment: ["cod"] }, effect: "deny", params: { refused_deliveries: 2, lookback_days: 90 }, priority: 5 },
    ],
  },

  /* ───── Warranty ───── */
  {
    code: "POL-WAR",
    area: "warranty",
    title: "Warranty",
    owner: "Customer Experience",
    version: 2,
    effective_from: "2026-06-01",
    summary: "Brand warranty: 12 months on audio, wearables and cameras (6 months on watch batteries), 6 months on bags. Physical or water damage isn't covered.",
    customer_text:
      "Headphones, smartwatches and cameras carry a 12-month brand warranty, and bags 6 months against stitching and zip faults. Warranty doesn't cover physical or water damage. We'll guide you to the brand's service centre.",
    rules: [
      { code: "WAR-AUDIO", title: "Audio: 12 months", description: "12-month manufacturer warranty, repaired or replaced through the brand's service centre after our 7-day replacement window.", conditions: { categories: ["Audio"] }, effect: "info", params: { months: 12, via: "brand service centre" }, priority: 10 },
      { code: "WAR-WEARABLES", title: "Wearables: 12 months, battery 6", description: "12-month warranty on smartwatches; batteries and straps 6 months.", conditions: { categories: ["Wearables"] }, effect: "info", params: { months: 12, battery_months: 6 }, priority: 10 },
      { code: "WAR-CAMERAS", title: "Cameras: 12 months", description: "12-month warranty; lens scratches and film are not covered.", conditions: { categories: ["Cameras"] }, effect: "info", params: { months: 12, excludes: ["lens scratches", "film"] }, priority: 10 },
      { code: "WAR-BAGS", title: "Bags: 6 months", description: "6 months against stitching and zip faults.", conditions: { categories: ["Bags"] }, effect: "info", params: { months: 6, covers: ["stitching", "zips"] }, priority: 10 },
      { code: "WAR-EXCLUSIONS", title: "What warranty doesn't cover", description: "Physical damage, liquid damage, unauthorised repairs and normal wear void the warranty.", effect: "deny", params: { excludes: ["physical damage", "liquid damage", "unauthorised repair", "normal wear"] }, priority: 5 },
    ],
  },

  /* ───── Exchanges ───── */
  {
    code: "POL-EXC",
    area: "exchanges",
    title: "Exchanges",
    owner: "Customer Experience",
    version: 1,
    effective_from: "2026-06-01",
    summary: "One free size or colour exchange on fashion within 30 days. Electronics are exchanged like for like, for defects only.",
    customer_text: "You can exchange clothing for another size or colour once, free, within 30 days of delivery, subject to stock.",
    rules: [
      { code: "EXC-FASHION", title: "One free fashion exchange", description: "One free size or colour exchange per item within 30 days of delivery, subject to stock. Otherwise it becomes a return.", conditions: { categories: ["Fashion"] }, effect: "allow", params: { window_days: 30, free_exchanges: 1 }, priority: 10 },
      { code: "EXC-ELECTRONICS", title: "Electronics: like for like", description: "Electronics are only exchanged for the same model, and only for defects within 7 days.", conditions: { categories: ELECTRONICS }, effect: "allow", params: { window_days: 7, same_model: true, reason: "defect only" }, priority: 10 },
    ],
  },

  /* ───── Address changes ───── */
  {
    code: "POL-ADR",
    area: "address_changes",
    title: "Address changes",
    owner: "Operations",
    version: 1,
    effective_from: "2026-06-01",
    summary: "Any change before dispatch. After dispatch only within the same city. High-value COD orders can't be redirected.",
    customer_text: "You can change the delivery address any time before your order ships. After that we can only change it within the same city.",
    rules: [
      { code: "ADR-BEFORE-SHIP", title: "Before dispatch: any address", description: "The address can be changed freely until the order ships.", conditions: { order_status: ["placed"] }, effect: "auto", priority: 10 },
      { code: "ADR-AFTER-SHIP", title: "After dispatch: same city only", description: "After dispatch the courier can only redirect within the same city or pincode area.", conditions: { order_status: ["shipped"] }, effect: "require", params: { scope: "same city" }, priority: 10 },
      { code: "ADR-COD-HIGH-VALUE", title: "High-value COD: no redirect", description: "COD orders above ₹5,000 can't have their address changed after ordering (a common fraud pattern); hand to the risk team.", conditions: { payment: ["cod"], min_amount: 5001 }, effect: "escalate", approver: "Risk team", priority: 5 },
    ],
  },

  /* ───── Price protection ───── */
  {
    code: "POL-PRC",
    area: "price_protection",
    title: "Price drop protection",
    owner: "Commercial",
    version: 1,
    effective_from: "2026-09-01",
    summary: "If our price drops within 7 days of delivery, the difference is given as store credit, once per order. Not during flash sales.",
    customer_text: "If the price of something you bought drops within 7 days of delivery, we'll give you the difference as store credit, once per order (not for flash sales).",
    rules: [
      { code: "PRC-DROP-7D", title: "Difference as store credit", description: "A drop in ShopKart's own price within 7 days of delivery is credited as store credit, once per order.", effect: "auto", params: { window_days: 7, claims_per_order: 1, paid_as: "store_credit" }, priority: 10 },
      { code: "PRC-EXCLUSIONS", title: "Not for flash sales or other sellers", description: "Doesn't apply to flash-sale prices, bank offers, coupons or other sellers' prices.", effect: "deny", params: { excludes: ["flash sales", "bank offers", "coupons", "other sellers"] }, priority: 5 },
    ],
  },

  /* ───── Goodwill compensation ───── */
  {
    code: "POL-CMP",
    area: "compensation",
    title: "Goodwill compensation",
    owner: "Customer Experience",
    version: 2,
    effective_from: "2026-10-01",
    summary: "Store credit for service failures: the AI up to ₹100 per ticket, a support person up to ₹500, a team lead up to ₹2,000. At most ₹1,000 per customer in 90 days.",
    customer_text: "When we get something wrong, we may add store credit to your account as an apology.",
    rules: [
      { code: "CMP-AI", title: "AI: up to ₹100", description: "Aria may add up to ₹100 store credit per ticket for a service failure (delay, repeat contact).", effect: "auto", params: { max_credit: 100 }, priority: 10 },
      { code: "CMP-AGENT", title: "Support person: up to ₹500", description: "A support person may add up to ₹500 store credit per ticket.", effect: "allow", approver: "Support agent", params: { max_credit: 500 }, priority: 20 },
      { code: "CMP-LEAD", title: "Team lead: up to ₹2,000", description: "Credit above ₹500 needs the support team lead; ₹2,000 is the most per ticket.", effect: "approval", approver: "Support team lead", params: { max_credit: 2000 }, priority: 30 },
      { code: "CMP-CAP", title: "₹1,000 per customer per 90 days", description: "Goodwill credit to one customer is capped at ₹1,000 in any 90 days. Above that, the team lead decides.", effect: "approval", approver: "Support team lead", params: { cap: 1000, lookback_days: 90 }, priority: 5 },
    ],
  },

  /* ───── Fraud and abuse ───── */
  {
    code: "POL-FRD",
    area: "fraud",
    title: "Fraud and abuse",
    owner: "Risk",
    version: 3,
    effective_from: "2026-10-01",
    summary: "Unusual refund patterns and high-value first orders go to the risk team. Legal threats, police or chargebacks go to a person straight away.",
    customer_text: "For your security, some orders and refunds are reviewed by our team before we complete them.",
    rules: [
      { code: "FRD-REFUND-VELOCITY", title: "More than 3 refunds in 30 days", description: "A customer with more than 3 refunds in 30 days gets no automatic refunds; each one goes to the risk team.", effect: "escalate", approver: "Risk team", params: { max_refunds: 3, lookback_days: 30 }, priority: 1 },
      { code: "FRD-REFUND-RATIO", title: "Refunds over 30% of orders", description: "If more than 30% of a customer's orders in 90 days were refunded (at least 5 orders), refunds are held for review.", effect: "escalate", approver: "Risk team", params: { max_ratio: 0.3, min_orders: 5, lookback_days: 90 }, priority: 2 },
      { code: "FRD-FIRST-ORDER-HIGH-VALUE", title: "First order above ₹25,000", description: "A new customer's first order above ₹25,000 is verified by phone before dispatch.", conditions: { min_amount: 25001 }, effect: "require", approver: "Risk team", params: { check: "phone verification before dispatch" }, priority: 5 },
      { code: "FRD-LEGAL", title: "Legal, police or chargeback", description: "Mentions of fraud, police, consumer court, a lawyer, a chargeback or threats go to a person immediately, at critical priority. Aria makes no promises.", effect: "escalate", approver: "Support team lead", params: { priority: "critical", assign_within_minutes: 15 }, priority: 0 },
    ],
  },

  /* ───── Service levels ───── */
  {
    code: "POL-SLA",
    area: "service_levels",
    title: "Service levels",
    owner: "Customer Experience",
    version: 2,
    effective_from: "2026-08-01",
    summary: "First reply: chat 2 minutes, WhatsApp 15 minutes, email 4 working hours. Critical tickets reach a person in 15 minutes. Most tickets resolved within 48 hours.",
    customer_text: "We reply to chats within 2 minutes and emails within 4 working hours, and resolve most requests within 48 hours.",
    rules: [
      { code: "SLA-FIRST-RESPONSE", title: "First reply times", description: "Chat within 2 minutes, WhatsApp within 15 minutes, email within 4 working hours.", effect: "info", params: { chat_minutes: 2, whatsapp_minutes: 15, email_working_hours: 4 }, priority: 10 },
      { code: "SLA-CRITICAL", title: "Critical: a person within 15 minutes", description: "Critical tickets (payments above ₹5,000, legal, safety) are assigned to a person within 15 minutes.", effect: "escalate", approver: "Support team lead", params: { assign_within_minutes: 15 }, priority: 5 },
      { code: "SLA-RESOLUTION", title: "Resolve within 48 hours", description: "Standard tickets are resolved within 48 hours; an approved refund is started within 24 hours of approval.", effect: "info", params: { resolve_hours: 48, refund_after_approval_hours: 24 }, priority: 20 },
      { code: "SLA-REOPEN", title: "Reopen on reply", description: "A customer reply within 7 days reopens a solved ticket; after that it starts a new one.", effect: "allow", params: { reopen_days: 7 }, priority: 30 },
    ],
  },

  /* ───── Privacy ───── */
  {
    code: "POL-PRV",
    area: "privacy",
    title: "Privacy and account security",
    owner: "Legal",
    version: 2,
    effective_from: "2026-07-01",
    summary: "Verify the customer before sharing order details. Never ask for OTPs, PINs, CVVs or passwords. Account deletion within 30 days; invoices kept 8 years.",
    customer_text: "We'll never ask for your OTP, UPI PIN, card CVV or password. We delete your account within 30 days of a request, except invoices we must keep by law.",
    rules: [
      { code: "PRV-VERIFY", title: "Verify before sharing", description: "Share order details only with the account holder: logged-in chat, or the order number plus the registered phone's last 4 digits or email.", effect: "require", params: { verify_with: ["logged_in_session", "order_id + phone_last4", "order_id + email"] }, priority: 1 },
      { code: "PRV-NO-SECRETS", title: "Never ask for secrets", description: "Never ask for or accept OTPs, UPI PINs, card numbers, CVVs or passwords, in any channel.", effect: "deny", params: { never: ["OTP", "UPI PIN", "card number", "CVV", "password"] }, priority: 0 },
      { code: "PRV-DELETION", title: "Account deletion", description: "Account deletion requests are completed within 30 days; GST invoices are kept for 8 years as the law requires.", effect: "escalate", approver: "Privacy team", params: { complete_within_days: 30, invoice_retention_years: 8 }, priority: 20 },
    ],
  },

  /* ───── Store credit ───── */
  {
    code: "POL-CRD",
    area: "store_credit",
    title: "Store credit",
    owner: "Finance",
    version: 1,
    effective_from: "2026-06-01",
    summary: "Store credit is valid 12 months, can be combined with other payments, and can't be withdrawn to a bank or used for gift cards.",
    customer_text: "Store credit is valid for 12 months and can be used with any other payment method. It can't be withdrawn or used to buy gift cards.",
    rules: [
      { code: "CRD-VALIDITY", title: "Valid 12 months", description: "Store credit expires 12 months after it is issued.", effect: "info", params: { valid_months: 12 }, priority: 10 },
      { code: "CRD-USE", title: "How it can be used", description: "Can be combined with any payment method; can't be withdrawn to a bank or used for gift cards.", effect: "deny", params: { not_for: ["bank withdrawal", "gift cards"] }, priority: 10 },
    ],
  },

  /* ───── Bulk and business orders ───── */
  {
    code: "POL-B2B",
    area: "bulk_orders",
    title: "Bulk and business orders",
    owner: "Sales",
    version: 2,
    effective_from: "2026-09-01",
    summary: "Volume discounts from 50 units, 50% advance, quotes valid 15 days. Discounts above 15% need the sales manager. Branding from 100 units.",
    customer_text:
      "Bulk orders get volume discounts from 50 units: 5% up to 199 units, 10% up to 999 and 15% from 1,000. We ask for 50% in advance and send a GST invoice. Quotes are valid for 15 days.",
    rules: [
      { code: "B2B-TIERS", title: "Volume discount tiers", description: "5% for 50–199 units, 10% for 200–999, 15% for 1,000 or more.", effect: "info", params: { tiers: ["50-199: 5%", "200-999: 10%", "1000+: 15%"], min_units: 50 }, priority: 10 },
      { code: "B2B-EXTRA-DISCOUNT", title: "Above 15% needs the sales manager", description: "Any discount above 15%, or free shipping on bulk, needs the sales manager's approval.", effect: "approval", approver: "Sales manager", params: { max_discount_without_approval: 15 }, priority: 5 },
      { code: "B2B-PAYMENT", title: "50% advance", description: "50% in advance, the rest before dispatch. GST invoice with the buyer's GSTIN.", effect: "require", params: { advance_percent: 50, invoice: "GST, with buyer GSTIN" }, priority: 20 },
      { code: "B2B-QUOTE-VALIDITY", title: "Quotes valid 15 days", description: "Quotes are valid for 15 days; after that prices are rechecked.", effect: "info", params: { valid_days: 15 }, priority: 30 },
      { code: "B2B-BRANDING", title: "Custom branding from 100 units", description: "Logo printing from 100 units, adding 7–10 working days. Non-cancellable once the proof is approved.", conditions: { tags: ["personalised"] }, effect: "require", params: { min_units: 100, extra_working_days: "7-10", cancellable_after_proof: false }, priority: 20 },
    ],
  },
];

/** Adds every policy and rule that isn't in the database yet (matched by code). Never overwrites an existing one. */
export async function ensurePolicies(db: Db): Promise<{ policies: number; rules: number }> {
  return db.transaction(async (tx) => {
    const added = await tx
      .insert(s.policies)
      .values(POLICIES.map(({ rules: _, effective_from, ...p }) => ({ ...p, status: "active" as const, effective_from: new Date(`${effective_from}T00:00:00+05:30`) })))
      .onConflictDoNothing()
      .returning({ code: s.policies.code });
    const rules = await tx
      .insert(s.policyRules)
      .values(
        POLICIES.flatMap((p) =>
          p.rules.map((r) => ({ conditions: {}, params: {}, approver: null, ...r, policy_code: p.code, active: true })),
        ),
      )
      .onConflictDoNothing()
      .returning({ code: s.policyRules.code });
    // Drizzle on Bun's Postgres driver stores jsonb as a JSON *string*. Unwrap it to a real object so the
    // policies can be queried in SQL (conditions->>'max_amount'); Drizzle reads both forms the same way.
    await tx.execute(sql`
      update policy_rules set
        conditions = case when jsonb_typeof(conditions) = 'string' then (conditions #>> '{}')::jsonb else conditions end,
        params = case when jsonb_typeof(params) = 'string' then (params #>> '{}')::jsonb else params end
      where jsonb_typeof(conditions) = 'string' or jsonb_typeof(params) = 'string'`);
    return { policies: added.length, rules: rules.length };
  });
}

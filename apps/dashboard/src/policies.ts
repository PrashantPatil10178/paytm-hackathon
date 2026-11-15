// How ShopKart's business policies read on screen: area and effect labels, and rule conditions and
// params as short readable parts. Shared by the Policies page and Ask Aria's policy card, and used
// for the text summary the model gets, so both say the same thing.
import type { PolicyArea, PolicyConditions, PolicyEffect, PolicyParams, PolicyRule, PolicyWithRules } from '@ph/shared'
import { rupees } from './lib'

export const AREA_LABELS: Record<PolicyArea, string> = {
  returns: 'Returns',
  refunds: 'Refunds',
  damaged_items: 'Damaged items',
  cancellations: 'Cancellations',
  shipping: 'Shipping',
  payments: 'Payments',
  cod: 'Cash on delivery',
  warranty: 'Warranty',
  exchanges: 'Exchanges',
  address_changes: 'Address changes',
  price_protection: 'Price protection',
  compensation: 'Goodwill',
  fraud: 'Fraud',
  service_levels: 'Service levels',
  privacy: 'Privacy',
  store_credit: 'Store credit',
  bulk_orders: 'Bulk orders',
}
export const POLICY_AREAS = Object.keys(AREA_LABELS) as PolicyArea[]
export const areaLabel = (a: string) => AREA_LABELS[a as PolicyArea] ?? a

// Colour carries meaning only: mint = the AI may act, amber = waits on a person, red = not allowed.
const NEUTRAL = 'bg-slate-100 text-slate-700 ring-slate-200'
export const EFFECTS: Record<PolicyEffect, { label: string; hint: string; badge: string }> = {
  auto: { label: 'AI acts', hint: 'Aria may act on its own', badge: 'bg-brand-50 text-brand-700 ring-brand-200' },
  allow: { label: 'Allowed', hint: 'Permitted, nothing to do', badge: NEUTRAL },
  require: { label: 'Requires', hint: 'Permitted once a condition is met', badge: NEUTRAL },
  approval: { label: 'Needs approval', hint: 'A person approves first', badge: 'bg-amber-50 text-amber-800 ring-amber-200' },
  escalate: { label: 'Escalate', hint: 'Handed to a team', badge: 'bg-amber-50 text-amber-800 ring-amber-200' },
  deny: { label: 'Not allowed', hint: 'Refused', badge: 'bg-red-50 text-red-700 ring-red-200' },
  info: { label: 'Info', hint: 'A fact to tell the customer', badge: NEUTRAL },
}
export const POLICY_EFFECTS = Object.keys(EFFECTS) as PolicyEffect[]
export const effectMeta = (e: string) => EFFECTS[e as PolicyEffect] ?? { label: e, hint: '', badge: NEUTRAL }

/** One readable piece of a rule. `mono` parts (money, numbers) render with the `.ref` class. */
export interface Part { label: string; value: string; mono: boolean }

const WORDS: Record<string, string> = { sla: 'SLA', qc: 'QC', gst: 'GST', gstin: 'GSTIN', cod: 'COD', otp: 'OTP', upi: 'UPI', cvv: 'CVV', pin: 'PIN', neft: 'NEFT', ist: 'IST', id: 'ID' }
const words = (s: string) => s.replace(/_/g, ' ').replace(/\b[a-z]+\b/gi, (w) => WORDS[w.toLowerCase()] ?? w)
const sentence = (s: string) => {
  const t = words(s).trim()
  return t ? t[0]!.toUpperCase() + t.slice(1) : t
}
const range = (v: string | number) => String(v).replace(/(\d)-(\d)/g, '$1–$2')
const list = (v: unknown): string => (Array.isArray(v) ? v.map((x) => words(String(x))).join(', ') : words(String(v)))

/** Params that are amounts in ₹. */
const MONEY = new Set(['cap', 'credit', 'express_fee', 'fee', 'free_above', 'free_from', 'max_amount', 'max_credit', 'max_order', 'pickup_fee', 'standard_fee', 'waived_from'])
const UNITS: [RegExp, string][] = [
  [/_?working_days$/, 'working days'],
  [/_?days$/, 'days'],
  [/_?hours$/, 'hours'],
  [/_?minutes$/, 'min'],
  [/_?months$/, 'months'],
  [/_?years$/, 'years'],
  [/_?percent$/, '%'],
]

export function paramParts(params: PolicyParams): Part[] {
  return Object.entries(params).map(([key, v]) => {
    if (MONEY.has(key) && typeof v === 'number') return { label: sentence(key), value: v === 0 ? 'Free' : rupees(v), mono: true }
    if (key === 'max_discount_without_approval') return { label: 'Discount without approval', value: `up to ${v}%`, mono: true }
    if (key === 'max_ratio' && typeof v === 'number') return { label: 'Max ratio', value: `${Math.round(v * 100)}%`, mono: true }
    if (typeof v === 'boolean') return { label: sentence(key), value: v ? 'Yes' : 'No', mono: false }
    for (const [re, unit] of UNITS) {
      if (re.test(key) && (typeof v === 'number' || typeof v === 'string')) {
        const label = sentence(key.replace(re, '')) || (unit === 'months' ? 'Term' : 'Time')
        return { label, value: unit === '%' ? `${v}%` : `${range(v)} ${unit}`, mono: true }
      }
    }
    return { label: sentence(key), value: typeof v === 'number' ? String(v) : list(v), mono: typeof v === 'number' }
  })
}

export function conditionParts(c: PolicyConditions): Part[] {
  const out: Part[] = []
  if (c.categories?.length) out.push({ label: 'Categories', value: c.categories.join(', '), mono: false })
  if (c.tags?.length) out.push({ label: 'Tags', value: list(c.tags), mono: false })
  if (c.order_status?.length) out.push({ label: 'Order', value: list(c.order_status), mono: false })
  if (c.payment?.length) out.push({ label: 'Payment', value: c.payment.map((p) => (p === 'cod' ? 'COD' : 'Prepaid')).join(', '), mono: false })
  if (c.min_amount != null || c.max_amount != null) {
    const value = c.min_amount != null && c.max_amount != null ? `${rupees(c.min_amount)}–${rupees(c.max_amount)}`
      : c.min_amount != null ? `${rupees(c.min_amount)} and up` : `up to ${rupees(c.max_amount)}`
    out.push({ label: 'Amount', value, mono: true })
  }
  if (c.reasons?.length) out.push({ label: 'Reasons', value: list(c.reasons), mono: false })
  if (c.channels?.length) out.push({ label: 'Channels', value: list(c.channels), mono: false })
  return out
}

/** "Decision SLA" → "decision SLA": lowercase for mid-sentence use, acronyms kept. */
export const midSentence = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s)

const partsText = (parts: Part[]) => parts.map((p) => `${midSentence(p.label)} ${p.value}`).join(', ')

/** One line per rule, for the model: "B2B-TIERS Volume discount tiers [info] (when …; min units 50): description". */
export function ruleText(r: PolicyRule) {
  const when = partsText(conditionParts(r.conditions))
  const params = partsText(paramParts(r.params))
  const extra = [when && `when ${when}`, params, r.approver && `approver ${r.approver}`].filter(Boolean).join('; ')
  return `${r.code} ${r.title} [${effectMeta(r.effect).label}]${extra ? ` (${extra})` : ''}: ${r.description}`
}

export const policyText = (p: PolicyWithRules, rules = p.rules) =>
  `${p.code} ${p.title} (v${p.version}, ${p.owner}). Customers are told: "${p.customer_text}" Rules: ${rules.map(ruleText).join(' | ')}`

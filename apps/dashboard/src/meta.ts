import { MessageCircle, MessagesSquare, Mail, Globe, Smartphone, Phone, ClipboardList, Webhook, CheckCircle2, ShieldX, ArrowUpRight, ShieldCheck, CreditCard, LifeBuoy, Users, Truck, Inbox, Hand, ShoppingBag, Megaphone, ScrollText } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import type { ComponentType } from 'react'
import type { ChannelId, Level, Status, StepResult } from './types'

/** Any icon we draw: a lucide icon or the ResolveAI glyph. */
export type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

// Icon tiles are neutral and bordered. Colour is reserved for meaning: mint = the AI, amber = a human gate.
const TILE = 'bg-ink/[0.04] text-slate-700 ring-1 ring-inset ring-ink/[0.08]'
const AI_TILE = 'bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-200'
const GATE_TILE = 'bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200'

export const CHANNELS: Record<ChannelId, { label: string; icon: Icon; tile: string }> = {
  chat: { label: 'ShopKart chat', icon: MessagesSquare, tile: TILE },
  voice: { label: 'Voice call', icon: Phone, tile: TILE },
  form: { label: 'Enquiry form', icon: ClipboardList, tile: TILE },
  api: { label: 'API', icon: Webhook, tile: TILE },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, tile: TILE },
  email: { label: 'Email', icon: Mail, tile: TILE },
  webchat: { label: 'Web chat', icon: Globe, tile: TILE },
  appchat: { label: 'App chat', icon: Smartphone, tile: TILE },
}

// Ticket severity. Always rendered with its text label, never colour alone.
export const LEVELS: Record<Level, { label: string; badge: string; dot: string; hex: string }> = {
  low: { label: 'Low', badge: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400', hex: '#7a7a84' },
  medium: { label: 'Medium', badge: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500', hex: '#50aaff' },
  high: { label: 'High', badge: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500', hex: '#f5a524' },
  critical: { label: 'Critical', badge: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500', hex: '#ff6166' },
}

export const STATUSES: Record<Status, { label: string; badge: string; dot: string }> = {
  open: { label: 'Open', badge: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400' },
  in_progress: { label: 'In progress', badge: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500' },
  waiting: { label: 'Waiting for human', badge: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500' },
  solved: { label: 'Solved', badge: 'bg-brand-50 text-brand-700 ring-brand-200', dot: 'bg-brand-500' },
}
export const STATUS_ORDER: Status[] = ['open', 'in_progress', 'waiting', 'solved']

export const RESULTS: Record<StepResult, { label: string; icon: Icon; badge: string; node: string }> = {
  success: { label: 'Success', icon: CheckCircle2, badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', node: 'bg-emerald-500' },
  blocked: { label: 'Blocked', icon: ShieldX, badge: 'bg-red-50 text-red-700 ring-red-200', node: 'bg-red-500' },
  escalated: { label: 'Escalated', icon: ArrowUpRight, badge: 'bg-amber-50 text-amber-800 ring-amber-200', node: 'bg-amber-500' },
}

export const TOOLS: Record<string, { icon: Icon; tile: string }> = {
  'Aria LLM': { icon: ResolveAIGlyph, tile: AI_TILE },
  'Policy engine': { icon: ShieldCheck, tile: TILE },
  Policies: { icon: ScrollText, tile: TILE },
  Approvals: { icon: Hand, tile: GATE_TILE },
  Paytm: { icon: CreditCard, tile: TILE },
  Zendesk: { icon: LifeBuoy, tile: TILE },
  Freshdesk: { icon: LifeBuoy, tile: TILE },
  HubSpot: { icon: Users, tile: TILE },
  Shiprocket: { icon: Truck, tile: TILE },
  Email: { icon: Mail, tile: TILE },
  WhatsApp: { icon: MessageCircle, tile: TILE },
  'Web chat': { icon: Globe, tile: TILE },
  'App chat': { icon: Smartphone, tile: TILE },
  ShopKart: { icon: ShoppingBag, tile: TILE },
  Shop: { icon: ShoppingBag, tile: TILE },
  CRM: { icon: Users, tile: TILE },
  Sarvam: { icon: Phone, tile: TILE },
  Voice: { icon: Phone, tile: TILE },
  Campaigns: { icon: Megaphone, tile: TILE },
}
/** A channel's look; unknown ids (a newer API) fall back to a neutral inbox. */
export const channelMeta = (id: string) => CHANNELS[id as ChannelId] ?? { label: id, icon: Inbox, tile: TILE }
export const toolMeta = (t: string) => TOOLS[t] || { icon: Inbox, tile: TILE }

// Chart colours per theme. They mirror the tokens in index.css: SVG attributes can't read CSS vars.
export const CHART = {
  // ai/human are the one categorical pair, validated per theme (lightness band, CVD and contrast vs surface).
  // bar = the single neutral fill for one-series charts; track = the unfilled remainder of a part-of-whole bar.
  light: { ai: '#12a46e', human: '#5160d6', bar: '#52525b', track: '#e4e4e7', line: '#18181b', grid: '#ededef', tick: '#71717a', surface: '#ffffff', cursor: 'rgb(9 9 11 / 0.04)' },
  dark: { ai: '#22a66e', human: '#7a82ee', bar: '#a1a1aa', track: '#34343a', line: '#ededf0', grid: '#232327', tick: '#7a7a84', surface: '#161618', cursor: 'rgb(255 255 255 / 0.04)' },
}

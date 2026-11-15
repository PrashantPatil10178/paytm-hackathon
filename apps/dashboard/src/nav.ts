import { House, LifeBuoy, MessageCircle, MessagesSquare, Handshake, Cable, LayoutGrid, ShieldCheck, Inbox, SquareKanban, Users, Radio, SlidersHorizontal, Logs, ChartColumnBig, Megaphone, ChartPie, Phone, ScrollText } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { DEAL_STAGES } from '@ph/shared'
import type { Icon } from './meta'

// Two-level navigation. The rail holds the areas, which are global; the panel beside it holds the
// pages of the area you are in. Every page belongs to exactly one area.

export type AreaId = 'home' | 'support' | 'sales' | 'connect' | 'agent'

export interface Area {
  id: AreaId
  label: string
  icon: Icon
  /** Where the rail sends you the first time you open the area. */
  home: string
  paths: string[]
}

export const AREAS: Area[] = [
  { id: 'home', label: 'Home', icon: House, home: '/', paths: ['/', '/analytics', '/approvals'] },
  { id: 'support', label: 'Support', icon: LifeBuoy, home: '/tickets', paths: ['/tickets', '/chats', '/conversations', '/support/calls', '/board'] },
  { id: 'sales', label: 'Sales', icon: Handshake, home: '/sales/analytics', paths: ['/sales/analytics', '/leads', '/calls', '/campaigns'] },
  { id: 'connect', label: 'Connect', icon: Cable, home: '/channels', paths: ['/channels', '/connectors'] },
  { id: 'agent', label: 'Aria', icon: ResolveAIGlyph, home: '/settings', paths: ['/settings', '/policies', '/audit'] },
]

export const areaOf = (pathname: string): Area => AREAS.find((a) => a.paths.includes(pathname)) ?? AREAS[0]!

export const PAGES: Record<string, { label: string; icon: Icon }> = {
  '/': { label: 'Overview', icon: LayoutGrid },
  '/analytics': { label: 'Analytics', icon: ChartColumnBig },
  '/approvals': { label: 'Approvals', icon: ShieldCheck },
  '/tickets': { label: 'Tickets', icon: Inbox },
  '/chats': { label: 'Chats', icon: MessageCircle },
  '/conversations': { label: 'Conversations', icon: MessagesSquare },
  '/board': { label: 'Board', icon: SquareKanban },
  '/leads': { label: 'Leads', icon: Users },
  '/calls': { label: 'Calls', icon: Phone },
  '/support/calls': { label: 'Calls', icon: Phone },
  '/campaigns': { label: 'Campaigns', icon: Megaphone },
  '/sales/analytics': { label: 'Sales analytics', icon: ChartPie },
  '/channels': { label: 'Channels', icon: Radio },
  '/connectors': { label: 'Connectors', icon: Cable },
  '/settings': { label: 'Settings', icon: SlidersHorizontal },
  '/policies': { label: 'Policies', icon: ScrollText },
  '/audit': { label: 'Audit log', icon: Logs },
}

// Sales pipeline order: a lead is a CRM deal, so its stages are the deal stages. Accepts the stage id
// ("quote_sent") or its label ("Quote sent"); unknown stages sort after these.
export const LEAD_STAGES = DEAL_STAGES
const stageIndex = (s: string) => {
  const i = DEAL_STAGES.findIndex((d) => d.id === s || d.label === s)
  return i < 0 ? DEAL_STAGES.length : i
}
export const byStage = (a: string, b: string) => stageIndex(a) - stageIndex(b)
export const stageLabel = (s: string) => DEAL_STAGES.find((d) => d.id === s || d.label === s)?.label ?? s

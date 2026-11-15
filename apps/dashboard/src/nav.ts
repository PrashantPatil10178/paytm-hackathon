import { House, LifeBuoy, Handshake, Cable, LayoutGrid, ShieldCheck, Inbox, SquareKanban, Users, Radio, SlidersHorizontal, Logs, ChartColumnBig, Megaphone, ChartPie } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
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
  { id: 'support', label: 'Support', icon: LifeBuoy, home: '/tickets', paths: ['/tickets', '/board'] },
  { id: 'sales', label: 'Sales', icon: Handshake, home: '/sales/analytics', paths: ['/sales/analytics', '/leads', '/campaigns'] },
  { id: 'connect', label: 'Connect', icon: Cable, home: '/channels', paths: ['/channels', '/connectors'] },
  { id: 'agent', label: 'Aria', icon: ResolveAIGlyph, home: '/settings', paths: ['/settings', '/audit'] },
]

export const areaOf = (pathname: string): Area => AREAS.find((a) => a.paths.includes(pathname)) ?? AREAS[0]!

export const PAGES: Record<string, { label: string; icon: Icon }> = {
  '/': { label: 'Overview', icon: LayoutGrid },
  '/analytics': { label: 'Analytics', icon: ChartColumnBig },
  '/approvals': { label: 'Approvals', icon: ShieldCheck },
  '/tickets': { label: 'Tickets', icon: Inbox },
  '/board': { label: 'Board', icon: SquareKanban },
  '/leads': { label: 'Leads', icon: Users },
  '/campaigns': { label: 'Campaigns', icon: Megaphone },
  '/sales/analytics': { label: 'Sales analytics', icon: ChartPie },
  '/channels': { label: 'Channels', icon: Radio },
  '/connectors': { label: 'Connectors', icon: Cable },
  '/settings': { label: 'Settings', icon: SlidersHorizontal },
  '/audit': { label: 'Audit log', icon: Logs },
}

// Sales pipeline order. Stages not listed here sort after these.
export const LEAD_STAGES = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']
const stageIndex = (s: string) => (LEAD_STAGES.includes(s) ? LEAD_STAGES.indexOf(s) : LEAD_STAGES.length)
export const byStage = (a: string, b: string) => stageIndex(a) - stageIndex(b)

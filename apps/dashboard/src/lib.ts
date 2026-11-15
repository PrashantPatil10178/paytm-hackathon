export const cn = (...c: Array<string | false | null | undefined | 0>) => c.filter(Boolean).join(' ')

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
export const rupees = (n: number | null | undefined) => (n == null ? '—' : inr.format(n))
export const num = (n: number) => new Intl.NumberFormat('en-IN').format(n)

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })

export const clockSec = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })

export function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function duration(fromIso: string, toIso: string) {
  const s = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export const secondsLabel = (s: number) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`

export const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

/** A demo app on the same host the Control Room was opened from (so links work over the network too). */
const appUrl = (env: string | undefined, port: number) =>
  env || (typeof window === 'undefined' ? `http://localhost:${port}` : `${window.location.protocol}//${window.location.hostname}:${port}`)
export const ZENDESK_URL = appUrl(import.meta.env.VITE_ZENDESK_URL, 3001)
export const HUBSPOT_URL = appUrl(import.meta.env.VITE_HUBSPOT_URL, 3002)
export const SHOP_URL = appUrl(import.meta.env.VITE_SHOP_URL, 3003)
/** The agent service (apps/agent), where channels send requests. */
export const AGENT_URL = appUrl(import.meta.env.VITE_AGENT_URL, 8000)
/** "localhost:3003" or "192.168.1.5:3003", for link text. */
export const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

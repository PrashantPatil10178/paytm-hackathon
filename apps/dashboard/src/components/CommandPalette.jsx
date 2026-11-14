import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, LayoutDashboard, ScrollText, Ticket, ShieldCheck, KanbanSquare, Radio, Plug, Settings,
  CornerDownLeft, TrendingUp,
} from 'lucide-react'
import { useApp } from '../store'
import { cn } from '../lib'
import { LEVELS } from '../meta'

const PAGES = [
  { label: 'Home', to: '/', icon: LayoutDashboard },
  { label: 'Audit log', to: '/audit', icon: ScrollText },
  { label: 'Tickets', to: '/tickets', icon: Ticket },
  { label: 'Approvals', to: '/approvals', icon: ShieldCheck },
  { label: 'Board', to: '/board', icon: KanbanSquare },
  { label: 'Channels', to: '/channels', icon: Radio },
  { label: 'Connectors', to: '/connectors', icon: Plug },
  { label: 'Agent settings', to: '/settings', icon: Settings },
]

export default function CommandPalette({ open, onClose }) {
  const { tickets, leads } = useApp()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
    }
  }, [open])

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    const match = (...fields) => !s || fields.some((f) => f?.toLowerCase().includes(s))
    const items = [
      ...PAGES.filter((p) => match(p.label)).map((p) => ({ ...p, group: 'Pages', key: p.to })),
      ...tickets
        .filter((t) => match(t.id, t.customer.name, t.issue))
        .slice(0, s ? 8 : 4)
        .map((t) => ({ key: t.id, group: 'Tickets', label: `${t.id} · ${t.issue}`, hint: t.customer.name, to: `/tickets?id=${t.id}`, icon: Ticket, level: t.level })),
      ...leads
        .filter((l) => match(l.id, l.name, l.company, l.need))
        .slice(0, s ? 5 : 2)
        .map((l) => ({ key: l.id, group: 'Leads', label: `${l.id} · ${l.need}`, hint: l.company, to: `/audit?ref=${l.id}`, icon: TrendingUp })),
    ]
    return items
  }, [q, tickets, leads])

  useEffect(() => { setActive(0) }, [q])

  if (!open) return null

  const go = (item) => {
    navigate(item.to)
    onClose()
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    if (e.key === 'Enter' && results[active]) go(results[active])
    if (e.key === 'Escape') onClose()
  }

  let lastGroup = null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-xl animate-pop overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <Search className="size-5 text-slate-400" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search by ticket ID, customer, issue or page…"
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
          />
          <kbd className="rounded border border-slate-200 px-1.5 text-[11px] text-slate-500">esc</kbd>
        </div>
        <ul className="scrollbar-thin max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-10 text-center text-sm text-slate-500">No results for "{q}"</li>}
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null
            lastGroup = r.group
            return (
              <li key={r.key}>
                {header && <p className="px-3 pt-3 pb-1 text-xs font-medium text-slate-500">{header}</p>}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm', i === active ? 'bg-brand-50 text-brand-700' : 'text-slate-700')}
                >
                  <r.icon className={cn('size-4 shrink-0', i === active ? 'text-brand-600' : 'text-slate-400')} />
                  <span className="truncate">{r.label}</span>
                  {r.level && <span className={cn('size-1.5 shrink-0 rounded-full', LEVELS[r.level].dot)} />}
                  {r.hint && <span className="ml-auto shrink-0 text-xs text-slate-400">{r.hint}</span>}
                  {i === active && <CornerDownLeft className={cn('size-3.5 shrink-0 text-brand-500', !r.hint && 'ml-auto')} />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

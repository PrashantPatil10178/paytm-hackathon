import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Quote, ScrollText, Search, UserRound, X } from 'lucide-react'
import type { PolicyArea, PolicyEffect, PolicyRule, PolicyWithRules } from '@ph/shared'
import { live } from '../api'
import { Badge, Button, Card, EmptyState, PageHeader, Select, Skeleton } from '../components/ui'
import { cn, num } from '../lib'
import { AREA_LABELS, POLICY_AREAS, POLICY_EFFECTS, areaLabel, conditionParts, effectMeta, midSentence, paramParts, type Part } from '../policies'

const dateLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * ShopKart's business policies, read-only (`GET /policies`). Every agent reads the same rules: the support,
 * sales, analysis and leads agents in their instructions and through `lookup_policies`, Ask Aria through
 * `show_policies`, the voice caller from its knowledge base.
 */
export default function Policies() {
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [area, setArea] = useState<PolicyArea | ''>('')
  const [effect, setEffect] = useState<PolicyEffect | ''>('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  // Search runs on the API (`?q=`), a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 250)
    return () => clearTimeout(t)
  }, [input])

  const { data, error } = live.usePolicies({ area: area || null, q: q || null, effect: effect || null })
  // Keep the last result on screen while a new filter loads, so typing doesn't flash the skeleton.
  const [kept, setKept] = useState(data)
  if (data && data !== kept) setKept(data)
  const policies = (data ?? kept)?.policies
  const loading = !data && !error

  const filtered = Boolean(q || area || effect)
  // A search or an effect filter is about rules, so show them without a click.
  const expandAll = Boolean(q || effect)

  const groups = useMemo(() => {
    const by = new Map<PolicyArea, PolicyWithRules[]>()
    for (const p of policies ?? []) by.set(p.area, [...(by.get(p.area) ?? []), p])
    // A search returns best matches first; keep that order. Otherwise the fixed area order.
    const order = q ? [...by.keys()] : POLICY_AREAS.filter((a) => by.has(a))
    return order.map((a) => ({ area: a, policies: by.get(a)! }))
  }, [policies, q])

  const ruleCount = (policies ?? []).reduce((n, p) => n + p.rules.length, 0)
  const toggle = (code: string) => setOpen((s) => {
    const next = new Set(s)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    return next
  })
  const clear = () => { setInput(''); setQ(''); setArea(''); setEffect('') }

  return (
    <div>
      <PageHeader
        title="Policies"
        description="ShopKart's business rules: what Aria may do on its own, what waits for a person, and what customers are told. Every agent reads these same rules. Read-only here."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Search policies"
            placeholder="Search: refund approval, fashion return…"
            className="h-8 w-72 rounded-full border border-ink/10 bg-ink/[0.03] pr-3 pl-9 text-[13px] outline-none placeholder:text-slate-400 hover:border-ink/15 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15"
          />
        </div>
        <Select
          label="Area"
          value={area}
          onChange={(v) => setArea(v as PolicyArea | '')}
          options={[{ value: '', label: 'All areas' }, ...POLICY_AREAS.map((a) => ({ value: a, label: AREA_LABELS[a] }))]}
        />
        <Select
          label="Effect"
          value={effect}
          onChange={(v) => setEffect(v as PolicyEffect | '')}
          options={[{ value: '', label: 'Any effect' }, ...POLICY_EFFECTS.map((e) => ({ value: e, label: effectMeta(e).label }))]}
        />
        {filtered && <Button size="sm" variant="ghost" icon={X} onClick={clear}>Clear</Button>}
        <span className="ref ml-auto text-xs text-slate-500">
          {policies ? `${num(policies.length)} ${policies.length === 1 ? 'policy' : 'policies'} · ${num(ruleCount)} rules` : ''}
        </span>
      </div>

      {error && !policies && (
        <Card><EmptyState icon={ScrollText} title="Policies aren't available" text={`The demo API didn't return them: ${error}`} /></Card>
      )}

      {loading && !policies && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Card key={i} className="p-5"><Skeleton className="h-4 w-48" /><Skeleton className="mt-3 h-3 w-3/4" /></Card>)}
        </div>
      )}

      {policies && policies.length === 0 && (
        <Card>
          {filtered ? (
            <EmptyState icon={Search} title="No policy matches" text="Try other words, or clear the filters to see every policy." action={<Button size="sm" onClick={clear}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={ScrollText} title="No policies yet" text="The API adds ShopKart's policies on startup (ensurePolicies). Restart the API to load them." />
          )}
        </Card>
      )}

      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.area}>
            <h2 className="mb-2 flex items-baseline gap-2 px-1 text-xs font-medium text-slate-500">
              {areaLabel(g.area)}
            </h2>
            <div className="space-y-2">
              {g.policies.map((p) => (
                <PolicyCard key={p.code} policy={p} open={expandAll || open.has(p.code)} onToggle={() => toggle(p.code)} canToggle={!expandAll} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function PolicyCard({ policy: p, open, onToggle, canToggle }: { policy: PolicyWithRules; open: boolean; onToggle: () => void; canToggle: boolean }) {
  const gates = p.rules.filter((r) => r.effect === 'approval' || r.effect === 'escalate').length
  return (
    <Card className="overflow-hidden">
      <div className="p-5">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-baseline gap-x-2 font-semibold text-slate-950">
              {p.title}
              <span className="ref text-xs font-normal text-slate-500">{p.code}</span>
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              <span className="ref">v{p.version}</span> · owned by {p.owner} · in effect since <span className="ref">{dateLabel(p.effective_from)}</span>
            </p>
          </div>
          {p.status !== 'active' && <Badge className="bg-slate-100 text-slate-600 ring-slate-200">{p.status}</Badge>}
        </div>

        <p className="mt-3 text-sm text-slate-700">{p.summary}</p>

        <figure className="mt-3 flex gap-2.5 rounded-lg border border-ink/[0.06] bg-ink/[0.02] px-3.5 py-2.5">
          <Quote className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
          <div className="min-w-0">
            <figcaption className="text-[11px] font-medium text-slate-500">What customers are told</figcaption>
            <blockquote className="mt-0.5 text-sm text-slate-800">{p.customer_text}</blockquote>
          </div>
        </figure>
      </div>

      <button
        onClick={onToggle}
        disabled={!canToggle}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 border-t border-ink/[0.06] px-5 py-2.5 text-left text-xs text-slate-600',
          canToggle ? 'cursor-pointer hover:bg-ink/[0.03]' : 'cursor-default',
        )}
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden />
        <span className="font-medium text-slate-800"><span className="ref">{p.rules.length}</span> {p.rules.length === 1 ? 'rule' : 'rules'}</span>
        {gates > 0 && <span className="text-slate-500">· <span className="ref">{gates}</span> wait on a person</span>}
      </button>

      {open && (
        <ol className="divide-y divide-ink/[0.06] border-t border-ink/[0.06]">
          {p.rules.map((r) => <RuleRow key={r.code} rule={r} />)}
        </ol>
      )}
    </Card>
  )
}

export function EffectBadge({ effect }: { effect: string }) {
  const e = effectMeta(effect)
  return <Badge className={e.badge}><span title={e.hint}>{e.label}</span></Badge>
}

function RuleRow({ rule: r }: { rule: PolicyRule }) {
  const when = conditionParts(r.conditions)
  const params = paramParts(r.params)
  return (
    <li className="grid grid-cols-[2.5rem_1fr] gap-x-3 px-5 py-3.5">
      <span className="ref pt-0.5 text-[11px] text-slate-400" title="Priority: lower runs first">#{r.priority}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-slate-950">{r.title}</span>
          <EffectBadge effect={r.effect} />
          <span className="ref text-[11px] text-slate-500">{r.code}</span>
        </div>
        <p className="mt-1 text-sm text-slate-600">{r.description}</p>
        {(when.length > 0 || params.length > 0 || r.approver) && (
          <dl className="mt-2 flex flex-wrap gap-1.5">
            {when.map((c) => <Chip key={`w-${c.label}`} part={c} when />)}
            {params.map((c) => <Chip key={`p-${c.label}`} part={c} />)}
            {r.approver && (
              <div className="inline-flex items-center gap-1 rounded-md bg-ink/[0.04] px-2 py-1 text-xs">
                <dt className="sr-only">Approver</dt>
                <UserRound className="size-3 text-human" aria-hidden />
                <dd className="text-slate-800">{r.approver}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </li>
  )
}

function Chip({ part, when }: { part: Part; when?: boolean }) {
  return (
    <div className={cn('inline-flex items-baseline gap-1 rounded-md px-2 py-1 text-xs', when ? 'ring-1 ring-inset ring-ink/[0.08]' : 'bg-ink/[0.04]')}>
      <dt className="text-slate-500">{when ? `If ${midSentence(part.label)}` : part.label}</dt>
      <dd className={cn('text-slate-800', part.mono && 'ref')}>{part.value}</dd>
    </div>
  )
}

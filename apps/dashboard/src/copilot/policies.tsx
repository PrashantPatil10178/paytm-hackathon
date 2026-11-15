// Ask Aria's policy tool: ShopKart's business rules, live from the demo API (`GET /policies`).
// Same rule as the other cards: the model passes only a code, an area or search words, and the card
// reads the real policies, so it can't quote a rule that doesn't exist. The handler hands the model
// the matching rules as text, so Aria can answer "what's the return window for fashion?" from them.
import { useEffect, useMemo, useRef } from 'react'
import { z } from 'zod'
import { ScrollText } from 'lucide-react'
import { useAgentContext, useFrontendTool } from '@copilotkit/react-core/v2'
import type { PolicyArea, PolicyWithRules } from '@ph/shared'
import { api, errorText, live } from '../api'
import { Badge } from '../components/ui'
import { cn } from '../lib'
import { POLICY_AREAS, areaLabel, effectMeta, midSentence, paramParts, policyText } from '../policies'
import { Frame, Loading, NotFound, OpenLink } from './frame'

const AREA = z.enum(POLICY_AREAS as [PolicyArea, ...PolicyArea[]])

interface Args { area?: PolicyArea; query?: string; code?: string }

/** What the card shows for these args: one policy by code, else the area / search matches (best first). */
const pick = (all: PolicyWithRules[], { code, area }: Args) =>
  code ? all.filter((p) => p.code === code.trim().toUpperCase()) : area ? all.filter((p) => p.area === area) : all

/** Rules worth a line in a compact card: the gates first (approval, escalate, deny), then the rest by priority. */
const RANK: Record<string, number> = { approval: 0, escalate: 0, deny: 1, auto: 2, require: 3, allow: 3, info: 4 }
const keyRules = (p: PolicyWithRules, n: number) =>
  [...p.rules].sort((a, b) => (RANK[a.effect] ?? 5) - (RANK[b.effect] ?? 5) || a.priority - b.priority).slice(0, n)

export function PoliciesCard({ area, query, code }: Args) {
  // A code or area is filtered here; search words go to the API, which ranks matches.
  const { data, error } = live.usePolicies({ q: code ? null : query ?? null })
  const title = code ? code.toUpperCase() : area ? `${areaLabel(area)} policy` : query ? `Policies · “${query}”` : 'Policies'
  if (!data && !error) return <Loading title={title} />
  if (!data) return <NotFound title={title}>Policies aren't available: {error}</NotFound>
  const shown = pick(data.policies, { area, code }).slice(0, code ? 1 : 3)
  if (shown.length === 0) return <NotFound title={title}>No policy matches. Every policy is on the Policies page.</NotFound>
  const single = shown.length === 1
  return (
    <Frame icon={ScrollText} title={title} meta={single ? `v${shown[0]!.version}` : `${shown.length} shown`} action={<OpenLink to="/policies">Policies</OpenLink>}>
      <ul className="divide-y divide-ink/[0.06]">
        {shown.map((p) => (
          <li key={p.code} className="px-3 py-2.5">
            <p className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium text-slate-950">{p.title}</span>
              <span className="ref shrink-0 text-[11px] text-slate-500">{p.code}</span>
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{p.summary}</p>
            <ul className="mt-2 space-y-1.5">
              {keyRules(p, single ? 5 : 3).map((r) => {
                const e = effectMeta(r.effect)
                const params = paramParts(r.params).slice(0, 2)
                return (
                  <li key={r.code} className="flex items-start gap-2 text-[11px]">
                    <Badge className={cn(e.badge, 'mt-px shrink-0 px-1.5 text-[10px]')}>{e.label}</Badge>
                    <span className="min-w-0 flex-1 leading-relaxed text-slate-700">
                      {r.title}
                      {params.length > 0 && (
                        <span className="text-slate-500"> · {params.map((x, i) => (
                          <span key={x.label}>{i > 0 && ', '}{midSentence(x.label)} <span className={cn(x.mono && 'ref', 'text-slate-800')}>{x.value}</span></span>
                        ))}</span>
                      )}
                      {r.approver && <span className="text-slate-500"> · {r.approver}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
            {p.rules.length > (single ? 5 : 3) && <p className="ref mt-1.5 text-[10px] text-slate-400">+{p.rules.length - (single ? 5 : 3)} more rules</p>}
          </li>
        ))}
      </ul>
    </Frame>
  )
}

/** Registers show_policies and shares the policy digest with the model. Mounted inside the CopilotKit provider. */
export default function PolicyTools() {
  const { data } = live.usePolicies()
  const latest = useRef(data)
  useEffect(() => { latest.current = data })

  // One line per policy keeps the context small; the rules themselves come back from show_policies.
  const digest = useMemo(
    () => (data?.policies ?? []).map((p) => ({ code: p.code, area: p.area, title: p.title, summary: p.summary })),
    [data],
  )
  useAgentContext({
    description: "ShopKart's business policies (code, area, title, internal summary). Call show_policies for the exact rules before quoting a number.",
    value: digest,
  })

  useFrontendTool({
    name: 'show_policies',
    description:
      "Show ShopKart's business policies as a card and get their rules (windows, limits, fees, who approves). Pass a policy code " +
      '(e.g. POL-RET), or an area, or search words (e.g. "fashion return window", "refund approval"). Use it for any question about ' +
      'what is allowed, what needs approval or what customers are told.',
    parameters: z.object({
      code: z.string().max(20).optional().describe('A policy code from the context, e.g. POL-REF'),
      area: AREA.optional().describe('A policy area, e.g. returns, refunds, shipping, bulk_orders'),
      query: z.string().max(120).optional().describe('Search words, e.g. "fashion return window"'),
    }),
    handler: async (args) => {
      let all = latest.current?.policies ?? []
      try {
        // Search words are ranked by the API; the card asks the same question.
        if (args.query && !args.code) all = (await api.policies(args.query)).policies
      } catch (e) {
        return `Couldn't read the policies: ${errorText(e)}`
      }
      const shown = pick(all, args).slice(0, args.code ? 1 : 3)
      if (shown.length === 0) return 'No policy matches. Say so; do not guess a rule.'
      return `Card shown. ${shown.map((p) => policyText(p)).join('\n')}`
    },
    render: ({ args }) => <PoliciesCard {...(args as Args)} />,
  })

  return null
}

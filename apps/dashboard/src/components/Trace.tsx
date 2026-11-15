import { cn, clockSec, duration } from '../lib'
import { RESULTS, toolMeta } from '../meta'
import type { Step } from '../types'

// Vertical step-by-step timeline of everything the agent did on one ticket/lead.
export default function Trace({ steps, highlight }: { steps: Step[]; highlight?: number }) {
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const r = RESULTS[s.result]
        const t = toolMeta(s.tool)
        const last = i === steps.length - 1
        const took = i > 0 ? duration(steps[i - 1]!.time, s.time) : null
        return (
          <li key={i} className="relative flex gap-4 pb-5 last:pb-0" style={{ animationDelay: `${i * 40}ms` }}>
            {!last && <span className="absolute top-8 bottom-0 left-[15px] w-px bg-slate-200" />}
            <span className={cn('relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-surface', t.tile)}>
              <t.icon className="size-4" />
              <span className={cn('absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-surface', r.node)} />
            </span>
            <div className={cn('min-w-0 flex-1 rounded-lg px-3 py-2 -my-1', highlight === i && 'bg-brand-50/60 ring-1 ring-brand-100')}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-slate-900">{s.step}</span>
                <span className="text-xs text-slate-500">in {s.tool}</span>
                <span className={cn('ml-auto inline-flex items-center gap-1 text-xs font-medium',
                  s.result === 'success' ? 'text-emerald-700' : s.result === 'blocked' ? 'text-red-700' : 'text-amber-700')}>
                  <r.icon className="size-3.5" />{r.label}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-slate-600">{s.detail}</p>
              <p className="ref mt-1 text-[11px] text-slate-500">
                {clockSec(s.time)}{took && <> · +{took}</>}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

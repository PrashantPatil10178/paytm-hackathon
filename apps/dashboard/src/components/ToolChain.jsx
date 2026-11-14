import { cn } from '../lib'
import { RESULTS, toolMeta } from '../meta'

// Signature: a ticket drawn as the tools the agent went through, in order.
// Consecutive steps in the same tool share one node. Blocked / escalated hops get a coloured ring.
// `labels` prints each tool's name under its node; `live` adds a dashed, moving link to a hollow
// "next" node, so an open conversation visibly has work still in flight.
const RING = { blocked: 'ring-1 ring-red-500', escalated: 'ring-1 ring-amber-500' }

export function hops(steps = []) {
  const out = []
  for (const s of steps) {
    const last = out[out.length - 1]
    if (last && last.tool === s.tool) {
      last.steps.push(s.step)
      if (s.result !== 'success') last.result = s.result
    } else out.push({ tool: s.tool, steps: [s.step], result: s.result })
  }
  return out
}

export default function ToolChain({ steps, size = 'sm', live = false, animate = false, labels = false, max, className }) {
  const all = hops(steps)
  const shown = max && all.length > max ? all.slice(all.length - max) : all
  const hidden = all.length - shown.length
  const md = size === 'md'
  const label = all.map((h) => `${h.steps.join(', ')} in ${h.tool}`).join(', then ')
  // Connectors sit level with the centre of a node, whether or not labels hang underneath.
  const level = labels ? (md ? 'mt-[13.5px]' : 'mt-[9.5px]') : ''
  const item = cn('flex', labels ? 'items-start' : 'items-center')

  return (
    <ol className={cn('flex min-w-0', labels ? 'items-start' : 'items-center', className)} aria-label={`Agent path: ${label}`}>
      {hidden > 0 && (
        <li className={cn('mr-1 self-center font-mono text-slate-400', md ? 'text-xs' : 'text-[10px]')} aria-hidden>+{hidden}</li>
      )}
      {shown.map((h, i) => {
        const t = toolMeta(h.tool)
        const r = RESULTS[h.result]
        return (
          <li key={i} className={item} aria-hidden>
            {i > 0 && <span className={cn('h-px shrink-0 bg-slate-300', md ? 'w-4' : 'w-1.5', level)} />}
            <span
              className={cn('flex flex-col items-center gap-1.5', animate && 'animate-hop')}
              style={animate ? { animationDelay: `${i * 90}ms` } : undefined}
              title={`${h.steps.join(' → ')} · ${h.tool}${h.result !== 'success' ? ` · ${r.label}` : ''}`}
            >
              <span className={cn('grid shrink-0 place-items-center rounded-md', md ? 'size-7' : 'size-5', t.tile, RING[h.result])}>
                <t.icon className={md ? 'size-3.5' : 'size-3'} />
              </span>
              {labels && <span className="max-w-[76px] truncate font-mono text-[10px] leading-none text-slate-500">{h.tool}</span>}
            </span>
          </li>
        )
      })}
      {live && (
        <li
          className={cn(item, animate && 'animate-hop')}
          style={animate ? { animationDelay: `${shown.length * 90}ms` } : undefined}
          aria-hidden
        >
          <span className={cn('h-px shrink-0', md ? 'w-5' : 'w-2.5', level, 'animate-dash bg-[length:6px_1px] bg-[linear-gradient(90deg,var(--color-brand-500)_50%,transparent_0)]')} />
          <span className="flex flex-col items-center gap-1.5">
            <span className={cn('grid shrink-0 place-items-center rounded-md border border-dashed border-brand-500/70', md ? 'size-7' : 'size-5')}>
              <span className="size-1.5 animate-working rounded-full bg-brand-500" />
            </span>
            {labels && <span className="font-mono text-[10px] leading-none text-brand-600">next</span>}
          </span>
        </li>
      )}
    </ol>
  )
}

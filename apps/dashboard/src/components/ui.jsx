import { useEffect } from 'react'
import { X, CheckCircle2, Info, UserRound } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { cn } from '../lib'
import { LEVELS, STATUSES, RESULTS, CHANNELS, toolMeta } from '../meta'

export function Card({ className, children, ...rest }) {
  return (
    <div className={cn('rounded-xl border border-ink/[0.07] bg-surface', className)} {...rest}>
      {children}
    </div>
  )
}

/** Neutral bordered square that holds an icon, as in the reference card headers. */
export function IconTile({ icon: Icon, className, size = 'md' }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-lg border border-ink/[0.08] bg-ink/[0.03] text-slate-600',
        size === 'sm' ? 'size-7' : 'size-8',
        className,
      )}
      aria-hidden
    >
      <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} />
    </span>
  )
}

/**
 * Tray card, as in the references: header and footer sit in a tinted tray, the content in an
 * inset panel. `bodyClassName` styles the inset panel.
 */
export function Panel({ icon, title, meta, action, footer, className, bodyClassName, children, ...rest }) {
  return (
    <section className={cn('rounded-2xl border border-ink/[0.06] bg-tray p-1', className)} {...rest}>
      <header className="flex min-h-11 items-center gap-2.5 py-1.5 pr-1.5 pl-2.5">
        {icon && <IconTile icon={icon} size="sm" />}
        <h3 className="flex min-w-0 flex-1 items-baseline gap-2 text-[13px] font-medium text-slate-950">
          <span className="truncate">{title}</span>
          {meta != null && <span className="ref truncate text-xs font-normal text-slate-500">{meta}</span>}
        </h3>
        {action}
      </header>
      <div className={cn('overflow-hidden rounded-xl border border-ink/[0.06] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]', bodyClassName)}>
        {children}
      </div>
      {footer && <footer className="flex min-h-9 items-center justify-between gap-3 px-2.5 pt-1.5 pb-0.5 text-xs text-slate-500">{footer}</footer>}
    </section>
  )
}

const BTN = {
  primary: 'bg-slate-950 text-canvas hover:bg-slate-800',
  secondary: 'border border-ink/10 bg-ink/[0.03] text-slate-800 hover:border-ink/15 hover:bg-ink/[0.07] hover:text-slate-950',
  ghost: 'text-slate-600 hover:bg-ink/[0.06] hover:text-slate-950',
  danger: 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
  destructive: 'bg-red-500 text-canvas hover:bg-red-600',
  dark: 'border border-ink/10 bg-ink/[0.06] text-slate-900 hover:bg-ink/10',
}
export function Button({ variant = 'secondary', size = 'md', icon: Icon, className, children, ...rest }) {
  return (
    <button
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-7 px-3 text-xs' : 'h-8 px-3.5 text-[13px]',
        BTN[variant],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} />}
      {children}
    </button>
  )
}

export function Badge({ className, dot, children }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', className)}>
      {dot && <span className={cn('size-1.5 rounded-full', dot)} />}
      {children}
    </span>
  )
}

export const LevelBadge = ({ level }) => (
  <Badge className={LEVELS[level].badge} dot={LEVELS[level].dot}>{LEVELS[level].label}</Badge>
)
export const StatusBadge = ({ status }) => (
  <Badge className={STATUSES[status].badge} dot={STATUSES[status].dot}>{STATUSES[status].label}</Badge>
)
export function ResultBadge({ result }) {
  const r = RESULTS[result]
  return (
    <Badge className={r.badge}>
      <r.icon className="size-3" />
      {r.label}
    </Badge>
  )
}

export function SolvedBy({ by }) {
  if (!by) return <span className="text-xs text-slate-400">—</span>
  return by === 'ai' ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700">
      <span className="grid size-5 place-items-center rounded-full bg-brand-50"><ResolveAIGlyph className="size-3.5" /></span>AI
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-human">
      <span className="grid size-5 place-items-center rounded-full bg-indigo-50"><UserRound className="size-3" /></span>Human
    </span>
  )
}

export function ChannelTag({ channel, compact }) {
  const c = CHANNELS[channel]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600" title={c.label}>
      <span className={cn('grid size-6 place-items-center rounded-md', c.tile)}><c.icon className="size-3.5" /></span>
      {compact ? <span className="sr-only">{c.label}</span> : c.label}
    </span>
  )
}

export function ToolTag({ tool }) {
  const t = toolMeta(tool)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
      <span className={cn('grid size-6 place-items-center rounded-md', t.tile)}><t.icon className="size-3.5" /></span>
      {tool}
    </span>
  )
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors', checked ? 'bg-brand-500' : 'bg-slate-300')}
    >
      <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
    </button>
  )
}

function useEscape(open, onClose) {
  useEffect(() => {
    if (!open) return
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
}

export function Drawer({ open, onClose, title, subtitle, actions, children, width = 'max-w-xl' }) {
  useEscape(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <aside className={cn('absolute inset-y-0 right-0 flex w-full animate-slide-in flex-col border-l border-ink/[0.08] bg-surface shadow-[0_24px_64px_-16px_rgb(0_0_0/0.35)]', width)}>
        <header className="flex items-start justify-between gap-4 border-b border-ink/[0.06] px-6 py-4">
          <div className="min-w-0">{title}{subtitle && <div className="mt-1">{subtitle}</div>}</div>
          <div className="flex items-center gap-2">
            {actions}
            <button onClick={onClose} className="cursor-pointer rounded-lg p-1.5 text-slate-500 hover:bg-ink/[0.06] hover:text-slate-950" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
        </header>
        <div className="scrollbar-thin flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  )
}

export function Modal({ open, onClose, title, subtitle, children, footer, width = 'max-w-lg' }) {
  useEscape(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn('relative flex max-h-[85vh] w-full animate-pop flex-col rounded-2xl border border-ink/[0.08] bg-surface shadow-[0_24px_64px_-16px_rgb(0_0_0/0.35)]', width)}>
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-lg p-1.5 text-slate-500 hover:bg-ink/[0.06] hover:text-slate-950" aria-label="Close"><X className="size-5" /></button>
        </header>
        <div className="scrollbar-thin overflow-y-auto px-6 pb-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-ink/[0.06] px-6 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl leading-tight font-semibold tracking-[-0.02em] text-slate-950">{title}</h1>
        {description && <p className="mt-1.5 max-w-[68ch] text-sm text-pretty text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Segmented control, as in the reference's 1h / 24h / 7d / 30d switcher. */
export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div role="tablist" className={cn('inline-flex max-w-full overflow-x-auto rounded-full border border-ink/[0.07] bg-ink/[0.02] p-0.5 [scrollbar-width:none]', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium whitespace-nowrap transition-[background-color,color]',
            value === t.value ? 'bg-ink/[0.09] text-slate-950' : 'text-slate-500 hover:text-slate-900',
          )}
        >
          {t.icon && <t.icon className="size-3.5" />}
          {t.label}
          {t.count != null && (
            <span className={cn('ref rounded-full px-1.5 text-[11px]', value === t.value ? 'bg-ink/10 text-slate-800' : 'bg-ink/[0.05] text-slate-500')}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export function SectionTitle({ children, action }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-sm font-medium text-slate-950">{children}</h3>
      {action}
    </div>
  )
}

export const Skeleton = ({ className }) => <div className={cn('animate-pulse rounded-md bg-ink/[0.05]', className)} />

export function EmptyState({ icon: Icon = Info, title, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <IconTile icon={Icon} className="size-11 rounded-xl [&>svg]:size-5" />
      <h3 className="mt-4 text-sm font-medium text-slate-950">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Select({ value, onChange, options, className, label }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('h-8 cursor-pointer rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 pr-8 text-[13px] text-slate-800 hover:border-ink/15 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none', className)}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Toaster({ toasts, dismiss, className }) {
  return (
    <div className={cn('pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2', className)}>
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex animate-rise items-start gap-3 rounded-xl border border-ink/10 bg-raised px-4 py-3 text-slate-950 shadow-[0_24px_64px_-16px_rgb(0_0_0/0.35)]">
          {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-500" /> : <Info className="mt-0.5 size-4 shrink-0 text-slate-500" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t.title}</p>
            {t.desc && <p className="mt-0.5 text-xs text-slate-500">{t.desc}</p>}
          </div>
          {t.action && (
            <button
              className="cursor-pointer text-xs font-semibold text-brand-600 hover:text-brand-300"
              onClick={() => { t.action.onClick(); dismiss(t.id) }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

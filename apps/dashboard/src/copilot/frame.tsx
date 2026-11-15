// The frame every Ask Aria card sits in, plus its small helpers. Shared by cards.jsx and sales.tsx.
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Inbox } from 'lucide-react'
import { Skeleton } from '../components/ui'
import type { Icon } from '../meta'
import { cn } from '../lib'

/** Frame shared by every card: a hairline box with a small header strip. */
export function Frame({ icon: FrameIcon = Inbox, title, meta, action, children, className }: {
  icon?: Icon
  title: ReactNode
  meta?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('my-2 overflow-hidden rounded-xl border border-ink/[0.08] bg-surface text-slate-900 shadow-[0_1px_2px_rgb(0_0_0/0.04)]', className)}>
      <div className="flex h-9 items-center gap-2 border-b border-ink/[0.06] bg-tray/60 px-3">
        <FrameIcon className="size-3.5 shrink-0 text-slate-500" aria-hidden />
        <p className="flex min-w-0 flex-1 items-baseline gap-2 text-xs font-medium text-slate-950">
          <span className="truncate">{title}</span>
          {meta != null && <span className="ref shrink-0 font-normal text-slate-500">{meta}</span>}
        </p>
        {action}
      </div>
      {children}
    </div>
  )
}

export function OpenLink({ to, children = 'Open' }: { to: string; children?: ReactNode }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(to)}
      className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-ink/[0.06] hover:text-slate-950"
    >
      {children}<ArrowUpRight className="size-3" aria-hidden />
    </button>
  )
}

export function Loading({ title }: { title: ReactNode }) {
  return (
    <Frame title={title}>
      <div className="space-y-2 p-3">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </Frame>
  )
}

export const NotFound = ({ title, children }: { title: ReactNode; children: ReactNode }) => (
  <Frame title={title}><p className="px-3 py-3 text-xs text-slate-500">{children}</p></Frame>
)

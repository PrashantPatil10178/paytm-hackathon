// "Ask Aria": the owner's chat with the agent, docked on the right of the Control Room.
// CopilotChat handles messages and streaming; the cards it draws are registered in ./tools.jsx.
import { useState } from 'react'
import { CopilotChat } from '@copilotkit/react-core/v2'
import { SquarePen, TriangleAlert, X } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { useTheme } from '../theme'


// No attachments here, so drop the "+" menu rather than show a button that does nothing.
const NO_ADD_MENU = { addMenuButton: () => null }

function explain(error) {
  const m = String(error?.message ?? error ?? '')
  if (/fetch|network|ECONNREFUSED|Failed to|502|504/i.test(m)) return 'Can’t reach the Aria runtime on :4100. Start it with bun run dev:dashboard.'
  if (/api[ _-]?key|x-api-key|authentication|401/i.test(m)) return 'The runtime has no valid ANTHROPIC_API_KEY. Add it to the repo-root .env and restart it.'
  return m.slice(0, 220) || 'Something went wrong. Try again.'
}

function Welcome({ input, suggestionView }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="grid size-11 place-items-center rounded-xl border border-brand-200 bg-brand-50 text-brand-600">
          <ResolveAIGlyph className="size-6" />
        </span>
        <div>
          <p className="text-sm font-medium text-slate-950">Ask Aria about your workspace</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Tickets, approvals, leads and metrics. Answers come with live cards drawn from the Control Room’s own data.
          </p>
        </div>
      </div>
      <div className="px-1 pb-1">{suggestionView}</div>
      {input}
    </div>
  )
}

export default function ChatPanel({ open, onClose }) {
  // Each mount of CopilotChat starts its own thread, so "New chat" just remounts it. (Passing
  // threadId instead would hide the welcome screen: CopilotKit treats that as resuming a thread.)
  const [chat, setChat] = useState(0)
  const [error, setError] = useState(null)
  const { resolved } = useTheme()

  return (
    <aside hidden={!open} className={`aria-chat ${resolved === 'dark' ? 'dark' : ''} fixed inset-y-0 right-0 z-40 flex w-full animate-slide-in flex-col border-l border-ink/[0.07] bg-surface shadow-[-24px_0_48px_-24px_rgb(0_0_0/0.25)] sm:w-[420px]`} aria-label="Ask Aria">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-ink/[0.06] bg-canvas px-4">
        <span className="grid size-7 place-items-center rounded-lg border border-brand-200 bg-brand-50 text-brand-600">
          <ResolveAIGlyph className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-tight font-medium text-slate-950">Ask Aria</p>
          <p className="truncate text-[11px] leading-tight text-slate-500">Reads live Control Room data</p>
        </div>
        <button
          onClick={() => { setChat((n) => n + 1); setError(null) }}
          className="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition-colors hover:bg-ink/[0.06] hover:text-slate-950"
          aria-label="New chat" title="New chat"
        >
          <SquarePen className="size-4" />
        </button>
        <button
          onClick={onClose}
          className="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition-colors hover:bg-ink/[0.06] hover:text-slate-950"
          aria-label="Close Ask Aria" title="Close (⌘J)"
        >
          <X className="size-4" />
        </button>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="cursor-pointer text-amber-700 hover:text-amber-900" aria-label="Dismiss"><X className="size-3.5" /></button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <CopilotChat
          key={chat}
          className="h-full"
          welcomeScreen={Welcome}
          input={NO_ADD_MENU}
          labels={{ chatInputPlaceholder: 'Ask about tickets, approvals, leads…' }}
          onError={({ error: e }) => setError(explain(e))}
        />
      </div>
    </aside>
  )
}

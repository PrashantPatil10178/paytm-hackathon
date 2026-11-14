import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable,
} from '@dnd-kit/core'
import { LifeBuoy, Users, RefreshCw, Plus, UserRound } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { api } from '../api'
import { useApp } from '../store'
import { PageHeader, Tabs, LevelBadge, ChannelTag, Badge } from '../components/ui'
import { STATUSES, STATUS_ORDER } from '../meta'
import { ago, cn, rupees } from '../lib'

// A generic, column-based board. Items move between columns via drag and drop.
function Kanban({ columns, items, columnOf, onMove, renderCard, footer }) {
  const [activeId, setActiveId] = useState(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )
  const active = items.find((i) => i.id === activeId)

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveId(e.active.id)}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={(e) => {
        setActiveId(null)
        if (e.over) onMove(e.active.id, e.over.id)
      }}
    >
      <div className="scrollbar-thin -mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        {columns.map((col) => (
          <Column key={col.id} col={col} count={items.filter((i) => columnOf(i) === col.id).length} footer={footer?.(col.id)}>
            {items.filter((i) => columnOf(i) === col.id).map((item) => (
              <DraggableCard key={item.id} id={item.id}>{renderCard(item)}</DraggableCard>
            ))}
          </Column>
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.22,1,0.36,1)' }}>
        {active && <div className="rotate-2 cursor-grabbing shadow-2xl">{renderCard(active)}</div>}
      </DragOverlay>
    </DndContext>
  )
}

function Column({ col, count, children, footer }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id })
  return (
    <div className="flex w-72 shrink-0 flex-col xl:w-0 xl:min-w-0 xl:flex-1">
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className={cn('size-2 rounded-full', col.dot)} />
        <h3 className="text-sm font-semibold text-slate-800">{col.label}</h3>
        <span className="rounded-full bg-slate-200/70 px-1.5 text-[11px] font-medium text-slate-600 tabular">{count}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[420px] flex-1 flex-col gap-2.5 rounded-xl border-2 border-dashed p-2.5 transition-colors',
          isOver ? 'border-brand-500/60 bg-brand-50/60' : 'border-transparent bg-slate-100/70',
        )}
      >
        {children}
        {footer}
      </div>
    </div>
  )
}

function DraggableCard({ id, children }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn('cursor-grab touch-none outline-none active:cursor-grabbing', isDragging && 'opacity-30')}>
      {children}
    </div>
  )
}

function TicketCard({ t, onOpen }) {
  return (
    <div onClick={onOpen} className="group cursor-grab rounded-lg border border-slate-200 bg-surface p-3 shadow-[0_1px_2px_rgb(7_22_20/0.05)] transition-[border-color,box-shadow] hover:border-slate-300 hover:shadow-[0_6px_16px_-8px_rgb(7_22_20/0.25)]">
      <div className="flex items-center gap-2">
        <span className="ref text-xs font-medium text-slate-600">{t.id}</span>
        <LevelBadge level={t.level} />
        {t.amount && <span className="ml-auto shrink-0 text-xs font-semibold text-slate-800 tabular">{rupees(t.amount)}</span>}
      </div>
      <p className="mt-2 text-sm font-medium leading-snug text-slate-900">{t.issue}</p>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <ChannelTag channel={t.channel} compact />
        <span className="min-w-0 flex-1 truncate">{t.customer.name}</span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          {t.status === 'solved' && (t.solvedBy === 'ai' ? <ResolveAIGlyph className="size-3.5 text-brand-600" /> : <UserRound className="size-3.5 text-human" />)}
          {ago(t.createdAt)}
        </span>
      </div>
    </div>
  )
}

const OWNER = {
  P1: { label: 'P1 · UI', cls: 'bg-brand-500' },
  P2: { label: 'P2 · Agent', cls: 'bg-human' },
  P3: { label: 'P3 · APIs', cls: 'bg-amber-500' },
  P4: { label: 'P4 · Pitch', cls: 'bg-rose-500' },
}
const TAG = {
  Frontend: 'bg-brand-50 text-brand-700 ring-brand-200',
  Agent: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  Backend: 'bg-amber-50 text-amber-800 ring-amber-200',
  Pitch: 'bg-rose-50 text-rose-700 ring-rose-200',
}

function TaskCard({ task }) {
  const o = OWNER[task.owner]
  return (
    <div className="rounded-lg border border-slate-200 bg-surface p-3 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <Badge className={TAG[task.tag]}>{task.tag}</Badge>
      <p className={cn('mt-2 text-sm font-medium leading-snug text-slate-900', task.column === 'done' && 'text-slate-400 line-through')}>{task.title}</p>
      <div className="mt-3 flex items-center gap-2">
        <span className={cn('grid size-6 place-items-center rounded-full text-[10px] font-semibold text-canvas', o.cls)}>{task.owner}</span>
        <span className="text-xs text-slate-500">{o.label}</span>
        <span className="ml-auto text-[11px] text-slate-400">{task.id}</span>
      </div>
    </div>
  )
}

function AddTask({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-slate-500 transition hover:bg-surface hover:text-slate-800">
        <Plus className="size-4" /> Add task
      </button>
    )
  }
  const submit = () => {
    if (title.trim()) onAdd(title.trim())
    setTitle('')
    setOpen(false)
  }
  return (
    <div className="rounded-lg bg-surface p-2 shadow-sm ring-1 ring-brand-500">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false) }}
        onBlur={submit}
        placeholder="What needs doing?"
        className="w-full text-sm outline-none placeholder:text-slate-400"
      />
    </div>
  )
}

export default function Board() {
  const { tickets, moveTicket, toast } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState('helpdesk')
  const [tasks, setTasks] = useState([])
  const [syncing, setSyncing] = useState(false)

  useEffect(() => { api.getTeamTasks().then(setTasks) }, [])

  const sync = () => {
    setSyncing(true)
    setTimeout(() => { setSyncing(false); toast({ title: 'Board synced', desc: `${tickets.length} tickets from Zendesk & Freshdesk` }) }, 900)
  }

  return (
    <div>
      <PageHeader
        title="Board"
        description={tab === 'helpdesk' ? 'Helpdesk tickets live from Zendesk and Freshdesk. Drag a card to change its status, and it syncs back.' : 'What the hackathon team is shipping. Drag cards as you go.'}
        actions={tab === 'helpdesk' && (
          <button onClick={sync} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800">
            <RefreshCw className={cn('size-3.5', syncing && 'animate-spin')} />
            {syncing ? 'Syncing…' : 'Synced just now'}
          </button>
        )}
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'helpdesk', label: 'Helpdesk board', icon: LifeBuoy }, { value: 'team', label: 'Team board', icon: Users }]}
      />

      {tab === 'helpdesk' ? (
        <Kanban
          columns={STATUS_ORDER.map((s) => ({ id: s, label: STATUSES[s].label, dot: STATUSES[s].dot }))}
          items={tickets}
          columnOf={(t) => t.status}
          onMove={(id, col) => moveTicket(id, col)}
          renderCard={(t) => <TicketCard t={t} onOpen={() => navigate(`/tickets?id=${t.id}`)} />}
        />
      ) : (
        <Kanban
          columns={[
            { id: 'todo', label: 'To do', dot: 'bg-slate-400' },
            { id: 'doing', label: 'In progress', dot: 'bg-sky-500' },
            { id: 'done', label: 'Done', dot: 'bg-brand-500' },
          ]}
          items={tasks}
          columnOf={(t) => t.column}
          onMove={(id, col) => setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, column: col } : t)))}
          renderCard={(t) => <TaskCard task={t} />}
          footer={(col) => col === 'todo' && (
            <AddTask onAdd={(title) => setTasks((ts) => [...ts, { id: `T-${ts.length + 1}`, title, owner: 'P1', tag: 'Frontend', column: 'todo' }])} />
          )}
        />
      )}
    </div>
  )
}

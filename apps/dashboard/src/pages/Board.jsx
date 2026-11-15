import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable,
} from '@dnd-kit/core'
import { LifeBuoy, Users, Plus, UserRound, Trash2, Inbox } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { OWNER } from '@ph/shared'
import { api, errorText, live } from '../api'
import { useApp } from '../store'
import { PageHeader, Tabs, LevelBadge, ChannelTag, Badge, EmptyState } from '../components/ui'
import { STATUSES, STATUS_ORDER } from '../meta'
import { ago, cn, initials, rupees, SHOP_URL, hostOf } from '../lib'

// A generic, column-based board. Items move between columns via drag and drop.
function Kanban({ columns, items, columnOf, onMove, renderCard, footer, cardDrop = false }) {
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
              <DraggableCard key={item.id} id={item.id} drop={cardDrop}>{renderCard(item)}</DraggableCard>
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

/** With `drop`, the card is also a drop target ("card:<id>"), so a card dropped on it goes just before it. */
function DraggableCard({ id, children, drop }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id })
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: `card:${id}`, disabled: !drop })
  return (
    <div ref={dropRef} className={cn('rounded-lg transition-shadow', drop && isOver && !isDragging && 'shadow-[0_-3px_0_0_var(--color-brand-500)]')}>
      <div ref={setNodeRef} {...listeners} {...attributes} className={cn('cursor-grab touch-none outline-none active:cursor-grabbing', isDragging && 'opacity-30')}>
        {children}
      </div>
    </div>
  )
}

function TicketCard({ t, onOpen }) {
  return (
    <div onClick={onOpen} className="group cursor-grab rounded-lg border border-slate-200 bg-surface p-3 shadow-[0_1px_2px_rgb(7_22_20/0.05)] transition-[border-color,box-shadow] hover:border-slate-300 hover:shadow-[0_6px_16px_-8px_rgb(7_22_20/0.25)]">
      <div className="flex items-center gap-2">
        <span className="ref text-xs font-medium text-slate-600">{t.id}</span>
        <LevelBadge level={t.level} />
        {t.amount ? <span className="ref ml-auto shrink-0 text-xs font-semibold text-slate-800">{rupees(t.amount)}</span> : null}
      </div>
      <p className="mt-2 text-sm font-medium leading-snug text-slate-900">{t.issue}</p>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <ChannelTag channel={t.channel} compact />
        <span className="min-w-0 flex-1 truncate">{t.customer.name || 'Customer'}</span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          {t.status === 'solved' && (t.solvedBy === 'ai' ? <ResolveAIGlyph className="size-3.5 text-brand-600" /> : <UserRound className="size-3.5 text-human" />)}
          {ago(t.createdAt)}
        </span>
      </div>
    </div>
  )
}

const COLUMNS = [
  { id: 'todo', label: 'To do', dot: 'bg-slate-400' },
  { id: 'doing', label: 'In progress', dot: 'bg-sky-500' },
  { id: 'done', label: 'Done', dot: 'bg-brand-500' },
]
const TAGS = ['Frontend', 'Agent', 'Backend', 'Pitch']
const TAG_BADGE = 'bg-slate-100 text-slate-700 ring-slate-200'
const byPosition = (a, b) => a.position - b.position

function TaskCard({ task, onDelete, onRename }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const stop = (e) => e.stopPropagation()
  const commit = () => {
    setEditing(false)
    const next = title.trim()
    if (next && next !== task.title) onRename(next)
    else setTitle(task.title)
  }
  return (
    <div className="group rounded-lg border border-slate-200 bg-surface p-3 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="flex items-center gap-2">
        {task.tag && <Badge className={TAG_BADGE}>{task.tag}</Badge>}
        <button
          onPointerDown={stop}
          onKeyDown={stop}
          onClick={onDelete}
          aria-label={`Delete ${task.title}`}
          title="Delete task"
          className="ml-auto grid size-6 cursor-pointer place-items-center rounded-md text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {editing ? (
        <input
          autoFocus
          value={title}
          onPointerDown={stop}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setTitle(task.title); setEditing(false) } }}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          aria-label="Task title"
          className="mt-2 w-full rounded-md bg-ink/[0.03] px-1.5 py-1 text-sm text-slate-900 outline-none ring-1 ring-brand-500"
        />
      ) : (
        <p
          onDoubleClick={() => { setTitle(task.title); setEditing(true) }}
          title="Double-click to rename"
          className={cn('mt-2 text-sm leading-snug font-medium text-slate-900', task.column === 'done' && 'text-slate-400 line-through')}
        >
          {task.title}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {task.owner ? (
          <>
            <span className="grid size-6 place-items-center rounded-full bg-ink/[0.06] text-[10px] font-semibold text-slate-700">{initials(task.owner)}</span>
            <span className="truncate text-xs text-slate-500">{task.owner}</span>
          </>
        ) : <span className="text-xs text-slate-400">No owner</span>}
        <span className="ref ml-auto text-[11px] text-slate-400">{task.id}</span>
      </div>
    </div>
  )
}

function AddTask({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  // A one-person business: new tasks are the owner's unless someone else is typed in.
  const [owner, setOwner] = useState(OWNER.name)
  const [tag, setTag] = useState('')
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-slate-500 transition hover:bg-surface hover:text-slate-800">
        <Plus className="size-4" /> Add task
      </button>
    )
  }
  const reset = () => { setTitle(''); setOwner(OWNER.name); setTag(''); setOpen(false) }
  const submit = () => {
    if (title.trim()) onAdd({ title: title.trim(), ...(owner.trim() && { owner: owner.trim() }), ...(tag && { tag }) })
    reset()
  }
  const keys = (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') reset() }
  return (
    <div className="space-y-2 rounded-lg bg-surface p-2 shadow-sm ring-1 ring-brand-500">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={keys} placeholder="What needs doing?" aria-label="Task title" className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" />
      <div className="flex gap-2">
        <input value={owner} onChange={(e) => setOwner(e.target.value)} onKeyDown={keys} placeholder="Owner" aria-label="Owner" className="h-7 min-w-0 flex-1 rounded-md border border-ink/10 bg-transparent px-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500" />
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag" className="h-7 rounded-md border border-ink/10 bg-surface px-1.5 text-xs text-slate-800 outline-none focus:border-brand-500">
          <option value="">No tag</option>
          {TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="flex justify-end gap-1.5">
        <button onClick={reset} className="cursor-pointer rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-ink/[0.05] hover:text-slate-900">Cancel</button>
        <button onClick={submit} disabled={!title.trim()} className="cursor-pointer rounded-md bg-slate-950 px-2.5 py-1 text-xs font-medium text-canvas hover:bg-slate-800 disabled:opacity-50">Add</button>
      </div>
    </div>
  )
}

/** The team board, live from /control-room/board. Moves are shown at once and saved; the next poll confirms them. */
function TeamBoard() {
  const { toast } = useApp()
  const { data, error, refresh } = live.useBoard()
  const [local, setLocal] = useState(null)
  const tasks = local ?? data?.tasks ?? []

  const fail = (title) => (e) => toast({ tone: 'neutral', title, desc: errorText(e) })
  const settle = async (work, title) => {
    try { await work } catch (e) { fail(title)(e) }
    await refresh()
    setLocal(null)
  }

  // Drop on a column → end of it; drop on a card → just before that card. Every task in the
  // target column whose position changes is saved, so the order survives a reload.
  const move = (id, overId) => {
    const task = tasks.find((t) => t.id === id)
    if (!task) return
    const overTask = String(overId).startsWith('card:') ? tasks.find((t) => `card:${t.id}` === overId) : null
    if (overTask?.id === id) return
    const column = overTask ? overTask.column : overId
    const others = tasks.filter((t) => t.column === column && t.id !== id).sort(byPosition)
    const at = overTask ? others.findIndex((t) => t.id === overTask.id) : others.length
    const ordered = [...others.slice(0, at), { ...task, column }, ...others.slice(at)]
    const changed = ordered.map((t, i) => ({ ...t, position: i })).filter((t) => {
      const before = tasks.find((x) => x.id === t.id)
      return before.column !== t.column || before.position !== t.position
    })
    if (!changed.length) return
    setLocal(tasks.map((t) => changed.find((c) => c.id === t.id) ?? t))
    settle(Promise.all(changed.map((t) => api.updateTask(t.id, t.id === id ? { column: t.column, position: t.position } : { position: t.position }))), 'Couldn’t move the task')
  }
  const add = (task) => settle(api.addTask({ ...task, column: 'todo' }), 'Couldn’t add the task')
  const rename = (task, title) => {
    setLocal(tasks.map((t) => (t.id === task.id ? { ...t, title } : t)))
    settle(api.updateTask(task.id, { title }), 'Couldn’t rename the task')
  }
  const remove = (task) => {
    setLocal(tasks.filter((t) => t.id !== task.id))
    settle(api.deleteTask(task.id).then(() => toast({ tone: 'neutral', title: 'Task deleted', desc: task.title })), 'Couldn’t delete the task')
  }

  if (!data && error) return <EmptyState icon={Users} title="The team board isn't available" text={`The demo API didn't return it: ${error}`} />
  return (
    <>
      {data && tasks.length === 0 && <p className="mb-3 text-sm text-slate-500">No tasks yet. Add the first one under To do.</p>}
      <Kanban
        columns={COLUMNS}
        items={[...tasks].sort(byPosition)}
        columnOf={(t) => t.column}
        onMove={move}
        cardDrop
        renderCard={(t) => <TaskCard task={t} onDelete={() => remove(t)} onRename={(title) => rename(t, title)} />}
        footer={(col) => col === 'todo' && data && <AddTask onAdd={add} />}
      />
    </>
  )
}

export default function Board() {
  const { tickets, moveTicket, loading } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState('helpdesk')

  return (
    <div>
      <PageHeader
        title="Board"
        description={tab === 'helpdesk' ? 'Tickets live from Zendesk. Drag a card to change its status, and it syncs back.' : 'What the team is working on. Drag cards between columns or above another card; double-click a title to rename it.'}
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'helpdesk', label: 'Helpdesk board', icon: LifeBuoy, count: tickets.length }, { value: 'team', label: 'Team board', icon: Users }]}
      />

      {tab === 'helpdesk' ? (
        <>
          {!loading && tickets.length === 0 && (
            <p className="mb-3 flex items-center gap-2 text-sm text-slate-500"><Inbox className="size-4" aria-hidden />No tickets yet. Start a chat in ShopKart ({hostOf(SHOP_URL)}) and Aria's tickets land here.</p>
          )}
          <Kanban
            columns={STATUS_ORDER.map((s) => ({ id: s, label: STATUSES[s].label, dot: STATUSES[s].dot }))}
            items={tickets}
            columnOf={(t) => t.status}
            onMove={(id, col) => moveTicket(id, col)}
            renderCard={(t) => <TicketCard t={t} onOpen={() => navigate(`/tickets?id=${t.id}`)} />}
          />
        </>
      ) : <TeamBoard />}
    </div>
  )
}

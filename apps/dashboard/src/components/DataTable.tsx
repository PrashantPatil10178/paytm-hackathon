import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, Check, Minus, Plus, Redo2, Undo2 } from 'lucide-react'
import { Panel, Skeleton } from './ui'
import { cn } from '../lib'
import type { Icon } from '../meta'

/*
 * A spreadsheet-feeling table. Click a cell to select it (the box glides between cells), use the
 * arrow keys, double-click or press Enter to edit, Tab to commit and move on. Headers sort, and rows
 * slide to their new place. Row checkboxes give bulk actions; ⌘Z / ⌘⇧Z undo and redo every change.
 *
 * It is controlled: it never owns the rows. Every change goes out through `onRowsChange` as the
 * next full array plus a `Change` describing it, so the page can sync it (e.g. to the helpdesk).
 */

export type Edit<T> =
  | {
      type: 'text' | 'number'
      get: (row: T) => string | number
      /** Turn the typed text into a patch. Return null to reject it (the edit is dropped). */
      set: (row: T, value: string) => Partial<T> | null
      placeholder?: string
    }
  | {
      type: 'select'
      options: { value: string; label: string }[]
      get: (row: T) => string
      set: (row: T, value: string) => Partial<T>
      /** How an option looks in the menu, e.g. as the same badge the cell shows. */
      renderOption?: (value: string) => ReactNode
    }

export interface Column<T> {
  key: string
  header: string
  icon?: Icon
  /** Classes for this column's cells and header (width, alignment, wrapping). */
  className?: string
  render: (row: T) => ReactNode
  /** Makes the column sortable. */
  sort?: (row: T) => string | number
  edit?: Edit<T>
}

export interface Change<T> {
  updates: { id: string; before: Partial<T>; after: Partial<T> }[]
  removed: { row: T; index: number }[]
  added: { row: T; index: number }[]
}

export interface BulkAction<T> {
  label: string
  icon?: Icon
  tone?: 'danger'
  /** What happens to the selected rows: a patch for each, or removal. */
  apply: (rows: T[]) => { patch: (row: T) => Partial<T> } | { remove: true }
}

interface Props<T> {
  title: ReactNode
  icon?: Icon
  meta?: ReactNode
  /** Accessible name of the grid. */
  label: string
  rows: T[]
  getId: (row: T) => string
  columns: Column<T>[]
  /** Which rows show. Edits always apply to the full `rows`. */
  filter?: (row: T) => boolean
  onRowsChange: (next: T[], change: Change<T>) => void
  /** Enter or double-click on a cell that isn't editable. */
  onOpen?: (row: T) => void
  openId?: string | null
  bulkActions?: BulkAction<T>[]
  /** Makes "Add row" appear. The new row starts in edit mode on its first editable column. */
  onAddRow?: () => T
  addLabel?: string
  toolbar?: ReactNode
  loading?: boolean
  empty?: ReactNode
  hint?: string
  minWidth?: number
}

const EMPTY = { updates: [], removed: [], added: [] }

export function applyChange<T>(rows: T[], change: Change<T>, getId: (row: T) => string): T[] {
  const gone = new Set(change.removed.map((r) => getId(r.row)))
  let next = gone.size ? rows.filter((r) => !gone.has(getId(r))) : rows.slice()
  if (change.updates.length) {
    const patches = new Map(change.updates.map((u) => [u.id, u.after]))
    next = next.map((r) => {
      const p = patches.get(getId(r))
      return p ? { ...r, ...p } : r
    })
  }
  for (const a of [...change.added].sort((x, y) => x.index - y.index)) next.splice(Math.min(a.index, next.length), 0, a.row)
  return next
}

export const invert = <T,>(c: Change<T>): Change<T> => ({
  updates: c.updates.map((u) => ({ id: u.id, before: u.after, after: u.before })),
  removed: c.added,
  added: c.removed,
})

const letter = (i: number) => String.fromCharCode(65 + i)
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

function Checkbox({ state, onToggle, label }: { state: boolean | 'mixed'; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state}
      aria-label={label}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      className={cn(
        'grid size-4 cursor-pointer place-items-center rounded-[5px] border transition-[background-color,border-color] duration-150',
        state ? 'border-slate-900 bg-slate-900 text-canvas' : 'border-ink/20 bg-surface hover:border-ink/40',
      )}
    >
      {state === 'mixed' ? <Minus className="size-3" strokeWidth={2.5} /> : state ? <Check className="size-3" strokeWidth={2.5} /> : null}
    </button>
  )
}

type Cursor = { id: string; col: string }
type Editing = { id: string; col: string; draft: string; option: number }

export default function DataTable<T>(props: Props<T>) {
  const {
    title, icon, meta, label, rows, getId, columns, filter, onRowsChange, onOpen, openId, bulkActions, onAddRow,
    addLabel = 'Add row', toolbar, loading, empty, hint, minWidth = 860,
  } = props

  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [past, setPast] = useState<Change<T>[]>([])
  const [future, setFuture] = useState<Change<T>[]>([])
  const [focused, setFocused] = useState(false)

  const grid = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const rowEls = useRef(new Map<string, HTMLTableRowElement>())
  const cellEls = useRef(new Map<string, HTMLTableCellElement>())
  const lastTops = useRef<Map<string, number> | null>(null)

  const colIndex = useMemo(() => new Map(columns.map((c, i) => [c.key, i])), [columns])
  const display = useMemo(() => {
    const visible = filter ? rows.filter(filter) : rows.slice()
    const col = sort && columns.find((c) => c.key === sort.key)
    if (!col?.sort) return visible
    const by = col.sort
    // Stable: equal keys keep their original order.
    return visible
      .map((r, i) => ({ r, i, k: by(r) }))
      .sort((a, b) => (a.k < b.k ? -sort!.dir : a.k > b.k ? sort!.dir : a.i - b.i))
      .map((x) => x.r)
  }, [rows, filter, sort, columns])
  const ids = display.map(getId)
  const order = ids.join('|')

  // A cursor or edit on a row that's no longer shown (filtered out, deleted) simply ends.
  const live = cursor && ids.includes(cursor.id) ? cursor : null
  const edit = editing && live && editing.id === live.id && editing.col === live.col ? editing : null
  const shownSelected = ids.filter((id) => selected.has(id))

  /* ── Changes and history ── */

  const commit = (change: Change<T>) => {
    if (!change.updates.length && !change.removed.length && !change.added.length) return
    onRowsChange(applyChange(rows, change, getId), change)
    setPast((p) => [...p.slice(-99), change])
    setFuture([])
  }
  const undo = () => {
    const c = past.at(-1)
    if (!c) return
    const back = invert(c)
    onRowsChange(applyChange(rows, back, getId), back)
    setPast((p) => p.slice(0, -1))
    setFuture((f) => [...f, c])
  }
  const redo = () => {
    const c = future.at(-1)
    if (!c) return
    onRowsChange(applyChange(rows, c, getId), c)
    setFuture((f) => f.slice(0, -1))
    setPast((p) => [...p, c])
  }

  const setCell = (row: T, col: Column<T>, value: string) => {
    if (!col.edit) return
    const after = col.edit.set(row, value)
    if (!after) return
    const before = Object.fromEntries(Object.keys(after).map((k) => [k, row[k as keyof T]])) as Partial<T>
    const same = Object.keys(after).every((k) => Object.is(before[k as keyof T], after[k as keyof T]))
    if (!same) commit({ ...EMPTY, updates: [{ id: getId(row), before, after }] })
  }

  const runBulk = (action: BulkAction<T>) => {
    const picked = rows.filter((r) => selected.has(getId(r)))
    const result = action.apply(picked)
    if ('remove' in result) {
      commit({ ...EMPTY, removed: picked.map((row) => ({ row, index: rows.indexOf(row) })).sort((a, b) => a.index - b.index) })
    } else {
      commit({
        ...EMPTY,
        updates: picked.map((row) => {
          const after = result.patch(row)
          const before = Object.fromEntries(Object.keys(after).map((k) => [k, row[k as keyof T]])) as Partial<T>
          return { id: getId(row), before, after }
        }),
      })
    }
    setSelected(new Set())
  }

  const addRow = () => {
    if (!onAddRow) return
    const row = onAddRow()
    commit({ ...EMPTY, added: [{ row, index: rows.length }] })
    const first = columns.find((c) => c.edit && c.edit.type !== 'select')
    if (first) {
      setCursor({ id: getId(row), col: first.key })
      setEditing({ id: getId(row), col: first.key, draft: '', option: 0 })
    }
  }

  /* ── Cursor and editing ── */

  const rowOf = (id: string) => display.find((r) => getId(r) === id)
  const colOf = (key: string) => columns[colIndex.get(key) ?? -1]

  const startEdit = (at: Cursor, draft?: string) => {
    const row = rowOf(at.id)
    const col = colOf(at.col)
    if (!row || !col?.edit) return false
    const value = String(col.edit.get(row))
    const option = col.edit.type === 'select' ? Math.max(0, col.edit.options.findIndex((o) => o.value === value)) : 0
    setEditing({ ...at, draft: draft ?? value, option })
    return true
  }
  /** End the edit. `refocus` is false when focus is already leaving the table for something else. */
  const finishEdit = (save: boolean, then?: 'right' | 'down', refocus = true) => {
    if (edit && save) {
      const row = rowOf(edit.id)
      const col = colOf(edit.col)
      if (row && col?.edit) setCell(row, col, col.edit.type === 'select' ? col.edit.options[edit.option]?.value ?? edit.draft : edit.draft)
    }
    setEditing(null)
    if (then && live) move(then === 'right' ? 1 : 0, then === 'down' ? 1 : 0)
    if (refocus) grid.current?.focus({ preventScroll: true })
  }

  const move = (dx: number, dy: number) => {
    if (!display.length) return
    if (!live) { setCursor({ id: ids[0]!, col: columns[0]!.key }); return }
    const r = Math.min(Math.max(ids.indexOf(live.id) + dy, 0), ids.length - 1)
    const c = Math.min(Math.max((colIndex.get(live.col) ?? 0) + dx, 0), columns.length - 1)
    setCursor({ id: ids[r]!, col: columns[c]!.key })
  }

  const toggleRow = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allState: boolean | 'mixed' = shownSelected.length === 0 ? false : shownSelected.length === ids.length ? true : 'mixed'
  const toggleAll = () => setSelected(allState === true ? new Set() : new Set(ids))

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }

    // A select menu is open: the keys drive it.
    const col = edit && colOf(edit.col)
    if (edit && col?.edit?.type === 'select') {
      const n = col.edit.options.length
      if (e.key === 'ArrowDown') { e.preventDefault(); setEditing({ ...edit, option: (edit.option + 1) % n }) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setEditing({ ...edit, option: (edit.option - 1 + n) % n }) }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); finishEdit(true, e.key === 'Tab' ? 'right' : undefined) }
      else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false) }
      return
    }
    if (edit) return // the text input handles its own keys

    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const step = arrows[e.key]
    if (step) { e.preventDefault(); move(...step); return }
    if (e.key === 'Tab' && live) {
      const c = colIndex.get(live.col) ?? 0
      const last = e.shiftKey ? c === 0 : c === columns.length - 1
      if (!last) { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0) }
      return
    }
    if (e.key === 'Escape') { if (live) setCursor(null); else setSelected(new Set()); return }
    if (!live) return
    const row = rowOf(live.id)
    const c = colOf(live.col)
    if (!row || !c) return
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault()
      if (!startEdit(live) && e.key === 'Enter') onOpen?.(row)
      return
    }
    if (e.key === ' ') { e.preventDefault(); toggleRow(live.id); return }
    if (c.edit && c.edit.type !== 'select') {
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); setCell(row, c, ''); return }
      if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); startEdit(live, e.key) }
    }
  }

  const cellDown = (e: MouseEvent, id: string, col: string) => {
    if ((e.target as HTMLElement).closest('a, button, input')) return
    e.preventDefault()
    if (edit && (edit.id !== id || edit.col !== col)) finishEdit(true)
    setCursor({ id, col })
    grid.current?.focus({ preventScroll: true })
  }
  const cellDouble = (id: string, col: string) => {
    if (!startEdit({ id, col })) {
      const row = rowOf(id)
      if (row) onOpen?.(row)
    }
  }

  /* ── Motion: rows slide to their new place; the selection box glides between cells ── */

  useLayoutEffect(() => {
    const tops = new Map<string, number>()
    for (const id of ids) {
      const el = rowEls.current.get(id)
      if (el) tops.set(id, el.offsetTop)
    }
    const prev = lastTops.current
    lastTops.current = tops
    if (!prev || calm()) return
    for (const [id, top] of tops) {
      const el = rowEls.current.get(id)
      if (!el) continue
      const was = prev.get(id)
      if (was == null) el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE })
      else if (was !== top) el.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], { duration: 340, easing: EASE })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `order` captures the row order
  }, [order])

  const cursorKey = live ? `${live.id}:${live.col}` : ''
  useLayoutEffect(() => {
    const b = box.current
    const td = live && cellEls.current.get(`${live.id}:${live.col}`)
    if (!b) return
    if (!td) { b.style.opacity = '0'; return }
    const tr = td.parentElement as HTMLElement
    const visible = b.style.opacity === '1'
    // First appearance lands in place; later moves glide (the transition is on the element).
    b.style.transition = visible ? '' : 'none'
    b.style.transform = `translate(${td.offsetLeft}px, ${tr.offsetTop}px)`
    b.style.width = `${td.offsetWidth}px`
    b.style.height = `${tr.offsetHeight}px`
    b.style.opacity = '1'
    td.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure when the cell or the order changes
  }, [cursorKey, order, rows])

  /* ── Select menu, drawn in a portal so the table's scroll box can't clip it ── */

  const [menuAt, setMenuAt] = useState<{ top: number; left: number; width: number } | null>(null)
  const editCol = edit && colOf(edit.col)
  const selectEdit = editCol?.edit?.type === 'select' ? editCol.edit : null
  useLayoutEffect(() => {
    if (!edit || !selectEdit) { setMenuAt(null); return }
    const td = cellEls.current.get(`${edit.id}:${edit.col}`)
    if (!td) return
    const r = td.getBoundingClientRect()
    setMenuAt({ top: r.bottom + 4, left: r.left, width: r.width })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.id, edit?.col, !!selectEdit])
  useEffect(() => {
    if (!menuAt) return
    const close = () => setEditing(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [menuAt])

  const editable = columns.some((c) => c.edit)
  const footerHint = hint ?? (editable ? 'Double-click a cell to edit' : 'Double-click a row to open')
  const address = live ? `${letter(colIndex.get(live.col) ?? 0)}${ids.indexOf(live.id) + 1}` : null

  return (
    <Panel
      icon={icon}
      title={title}
      meta={meta}
      action={(
        <div className="flex items-center gap-0.5">
          {[
            { label: 'Undo', keys: '⌘Z', Icon: Undo2, run: undo, on: past.length > 0 },
            { label: 'Redo', keys: '⇧⌘Z', Icon: Redo2, run: redo, on: future.length > 0 },
          ].map((b) => (
            <button
              key={b.label}
              onClick={b.run}
              disabled={!b.on}
              aria-label={b.label}
              title={`${b.label} (${b.keys})`}
              className="grid size-7 cursor-pointer place-items-center rounded-lg text-slate-500 transition-colors hover:bg-ink/[0.06] hover:text-slate-950 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
            >
              <b.Icon className="size-4" />
            </button>
          ))}
        </div>
      )}
      footer={(
        <>
          <div className="flex min-h-7 items-center gap-1">
            {shownSelected.length > 0 ? (
              <div key="sel" className="flex animate-fade-in items-center gap-1">
                <span className="ref pr-2 font-medium text-slate-900">{shownSelected.length} selected</span>
                {bulkActions?.map((a) => (
                  <button
                    key={a.label}
                    onClick={() => runBulk(a)}
                    className={cn(
                      'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 font-medium transition-colors',
                      a.tone === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-ink/[0.06] hover:text-slate-950',
                    )}
                  >
                    {a.icon && <a.icon className="size-3.5" aria-hidden />}{a.label}
                  </button>
                ))}
                <button onClick={() => setSelected(new Set())} className="h-7 cursor-pointer rounded-lg px-2 text-slate-500 transition-colors hover:bg-ink/[0.06] hover:text-slate-900">Clear</button>
              </div>
            ) : onAddRow ? (
              <button key="add" onClick={addRow} className="inline-flex h-7 animate-fade-in cursor-pointer items-center gap-1.5 rounded-lg px-2 text-slate-500 transition-colors hover:bg-ink/[0.06] hover:text-slate-900">
                <Plus className="size-3.5" aria-hidden />{addLabel}
              </button>
            ) : (
              <span className="px-1">{display.length} of {rows.length}</span>
            )}
          </div>
          <span className={cn('px-1', address && 'ref text-slate-700')} aria-live="polite">{address ?? footerHint}</span>
        </>
      )}
    >
      {toolbar && <div className="flex flex-wrap items-center gap-3 border-b border-ink/[0.06] p-3">{toolbar}</div>}

      <div
        ref={grid}
        role="grid"
        aria-label={label}
        aria-rowcount={display.length + 1}
        aria-multiselectable
        tabIndex={0}
        onKeyDown={onKey}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setFocused(false)
          if (edit && selectEdit) setEditing(null)
        }}
        className="outline-none"
      >
        <div className="scrollbar-thin relative overflow-x-auto">
          <table className="relative w-full border-separate border-spacing-0 text-[13px]" style={{ minWidth }}>
            <thead>
              <tr>
                <th scope="col" className="w-11 border-b border-ink/[0.06] py-2 pr-1 pl-4 text-left">
                  <Checkbox state={allState} onToggle={toggleAll} label={allState === true ? 'Deselect all rows' : 'Select all rows'} />
                </th>
                {columns.map((c) => {
                  const on = sort?.key === c.key
                  const Head = c.icon
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}
                      className={cn('border-b border-ink/[0.06] px-1 py-1.5 text-left font-normal whitespace-nowrap', c.className)}
                    >
                      {c.sort ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                          className={cn(
                            'group/h flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
                            on ? 'bg-ink/[0.04] text-slate-900' : 'text-slate-500 hover:bg-ink/[0.04] hover:text-slate-800',
                          )}
                        >
                          {Head && <Head className="size-3.5 shrink-0 text-slate-400" aria-hidden />}
                          {c.header}
                          <ArrowUp
                            aria-hidden
                            className={cn(
                              'ml-auto size-3.5 shrink-0 transition-[rotate,opacity] duration-200',
                              on ? 'text-slate-700 opacity-100' : 'opacity-0 group-hover/h:opacity-40',
                              on && sort!.dir === -1 && 'rotate-180',
                            )}
                          />
                        </button>
                      ) : (
                        <span className="flex h-7 items-center gap-1.5 px-2 text-xs text-slate-500">
                          {Head && <Head className="size-3.5 shrink-0 text-slate-400" aria-hidden />}
                          {c.header}
                        </span>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`}><td colSpan={columns.length + 1} className="px-4 py-2.5"><Skeleton className="h-7" /></td></tr>
              ))}
              {display.map((row) => {
                const id = getId(row)
                const picked = selected.has(id)
                return (
                  <tr
                    key={id}
                    ref={(el) => { if (el) rowEls.current.set(id, el); else rowEls.current.delete(id) }}
                    aria-selected={picked}
                    className={cn(
                      'group/r relative transition-colors',
                      picked || id === openId
                        ? 'bg-[color-mix(in_oklab,var(--color-surface),var(--color-ink)_4%)]'
                        : 'bg-surface hover:bg-[color-mix(in_oklab,var(--color-surface),var(--color-ink)_2%)]',
                    )}
                  >
                    <td className="border-b border-ink/[0.05] py-2 pr-1 pl-4 align-middle group-last/r:border-b-0">
                      <Checkbox state={picked} onToggle={() => toggleRow(id)} label={`Select row ${id}`} />
                    </td>
                    {columns.map((c) => {
                      const k = `${id}:${c.key}`
                      const editingHere = edit?.id === id && edit.col === c.key
                      const textEdit = editingHere && c.edit && c.edit.type !== 'select'
                      return (
                        <td
                          key={c.key}
                          ref={(el) => { if (el) cellEls.current.set(k, el); else cellEls.current.delete(k) }}
                          role="gridcell"
                          aria-selected={live?.id === id && live.col === c.key}
                          aria-readonly={!c.edit}
                          onMouseDown={(e) => cellDown(e, id, c.key)}
                          onDoubleClick={() => cellDouble(id, c.key)}
                          className={cn('relative cursor-default border-b border-ink/[0.05] px-3 py-2 align-middle group-last/r:border-b-0', c.className)}
                        >
                          {c.render(row)}
                          {textEdit && (
                            <input
                              autoFocus
                              value={edit.draft}
                              placeholder={c.edit!.type !== 'select' ? c.edit!.placeholder : undefined}
                              inputMode={c.edit!.type === 'number' ? 'numeric' : undefined}
                              onChange={(e) => setEditing({ ...edit, draft: e.target.value })}
                              onFocus={(e) => { const n = e.target.value.length; e.target.setSelectionRange(n, n) }}
                              onBlur={(e) => {
                                // Focus going back to the grid means finishEdit already ran.
                                if (e.relatedTarget === grid.current) return
                                finishEdit(true, undefined, false)
                              }}
                              onKeyDown={(e) => {
                                e.stopPropagation()
                                if (e.key === 'Enter') { e.preventDefault(); finishEdit(true, 'down') }
                                if (e.key === 'Tab') { e.preventDefault(); finishEdit(true, 'right') }
                                if (e.key === 'Escape') { e.preventDefault(); finishEdit(false) }
                              }}
                              className="absolute inset-0 z-10 w-full bg-surface px-3 text-[13px] text-slate-950 outline-none placeholder:text-slate-400"
                            />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* The selection box. One element for the whole grid, so moving between cells is a glide. */}
          <div
            ref={box}
            aria-hidden
            className={cn(
              'pointer-events-none absolute top-0 left-0 z-20 rounded-md opacity-0 transition-[transform,width,height,box-shadow] duration-150 ease-out motion-reduce:transition-none',
              focused ? 'shadow-[inset_0_0_0_1.5px_var(--color-brand-500)]' : 'shadow-[inset_0_0_0_1.5px_var(--color-slate-300)]',
            )}
          />
        </div>
        {!loading && display.length === 0 && empty}
      </div>

      {selectEdit && edit && menuAt && createPortal(
        <ul
          role="listbox"
          aria-label={editCol!.header}
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-[70] min-w-40 animate-pop overflow-hidden rounded-xl border border-ink/[0.08] bg-raised p-1 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.3)]"
          style={{ top: menuAt.top, left: menuAt.left, width: Math.max(menuAt.width, 160) }}
        >
          {selectEdit.options.map((o, i) => {
            const current = String(selectEdit.get(rowOf(edit.id)!)) === o.value
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={i === edit.option}
                onMouseEnter={() => setEditing({ ...edit, option: i })}
                onClick={() => { const row = rowOf(edit.id); if (row) setCell(row, editCol!, o.value); setEditing(null); grid.current?.focus({ preventScroll: true }) }}
                className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px]', i === edit.option ? 'bg-ink/[0.06] text-slate-950' : 'text-slate-700')}
              >
                <span className="min-w-0 flex-1">{selectEdit.renderOption ? selectEdit.renderOption(o.value) : o.label}</span>
                {current && <Check className="size-3.5 shrink-0 text-slate-500" aria-label="current" />}
              </li>
            )
          })}
        </ul>,
        document.body,
      )}
    </Panel>
  )
}

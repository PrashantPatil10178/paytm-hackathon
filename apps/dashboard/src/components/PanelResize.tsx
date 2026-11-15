import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { cn } from '../lib'

// The area panel (inner sidebar) is resizable. Drag its edge: between MIN and MAX it follows you.
// Drag it under SNAP and the labels drift left and fade from the top down as it narrows; let go
// there and it settles into the rail. The hide button and ⌘B play the same motion over 0.4s.
export const PANEL = { MIN: 200, MAX: 360, DEFAULT: 232, SNAP: 160 } as const

const OPEN_KEY = 'resolveai-panel-hidden'
const WIDTH_KEY = 'resolveai-panel-width'
const DURATION = 400

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const easeOut = (t: number) => 1 - (1 - t) ** 3
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function read<T>(key: string, parse: (v: string | null) => T): T {
  try { return parse(localStorage.getItem(key)) } catch { return parse(null) }
}
function save(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* private mode */ }
}

/** Open/closed state and live width of the panel, with the drag and the 0.4s glide. */
export function usePanelWidth() {
  const [open, setOpen] = useState(() => read(OPEN_KEY, (v) => v !== '1'))
  // The width it returns to when reopened.
  const [rest, setRest] = useState(() => read(WIDTH_KEY, (v) => clamp(Number(v) || PANEL.DEFAULT, PANEL.MIN, PANEL.MAX)))
  const [width, setWidth] = useState(open ? rest : 0)
  // True while the width changes frame by frame (drag or glide): CSS transitions would lag behind.
  const [live, setLive] = useState(false)
  const frame = useRef(0)
  const widthRef = useRef(width)
  useLayoutEffect(() => { widthRef.current = width }, [width])

  useEffect(() => save(OPEN_KEY, open ? '0' : '1'), [open])
  useEffect(() => save(WIDTH_KEY, String(rest)), [rest])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const glide = useCallback((to: number, done?: () => void) => {
    cancelAnimationFrame(frame.current)
    const from = widthRef.current
    if (calm() || from === to) {
      setWidth(to)
      setLive(false)
      done?.()
      return
    }
    // Shorter distances take proportionally less time, so a small settle doesn't feel sluggish.
    const ms = DURATION * clamp(Math.abs(to - from) / PANEL.DEFAULT, 0.35, 1)
    const start = performance.now()
    setLive(true)
    const step = (now: number) => {
      const t = clamp((now - start) / ms, 0, 1)
      setWidth(from + (to - from) * easeOut(t))
      if (t < 1) frame.current = requestAnimationFrame(step)
      else { setLive(false); done?.() }
    }
    frame.current = requestAnimationFrame(step)
  }, [])

  const collapse = useCallback(() => glide(0, () => setOpen(false)), [glide])
  const expand = useCallback(() => {
    setOpen(true)
    glide(rest)
  }, [glide, rest])
  const toggle = useCallback(() => (open ? collapse() : expand()), [open, collapse, expand])

  /** Called when a drag (or a keyboard resize) ends at `w`. */
  const settle = useCallback((w: number) => {
    if (w < PANEL.SNAP) {
      glide(0, () => setOpen(false))
      return
    }
    const to = clamp(w, PANEL.MIN, PANEL.MAX)
    setRest(to)
    glide(to)
  }, [glide])

  const drag = useCallback((w: number) => {
    cancelAnimationFrame(frame.current)
    setLive(true)
    setWidth(clamp(w, 0, PANEL.MAX))
  }, [])

  const reset = useCallback(() => { setRest(PANEL.DEFAULT); glide(PANEL.DEFAULT) }, [glide])

  return { open, width, live, toggle, collapse, expand, drag, settle, reset, rest }
}

type Panel = ReturnType<typeof usePanelWidth>

/**
 * Wraps the panel content: clips it to the live width and adds the drag handle on its right edge.
 * Exposes `--p` (0 at SNAP and wider, 1 at zero width) for the `.cascade-item` labels inside.
 */
export function ResizablePanel({ panel, children }: { panel: Panel; children: ReactNode }) {
  const { width, drag, settle, reset } = panel
  const [hint, setHint] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, w: 0 })
  const progress = clamp((PANEL.SNAP - width) / PANEL.SNAP, 0, 1)

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, w: width }
    setDragging(true)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    setHint(e.clientY - e.currentTarget.getBoundingClientRect().top)
    if (dragging) drag(start.current.w + e.clientX - start.current.x)
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    settle(start.current.w + e.clientX - start.current.x)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 16
    if (e.key === 'ArrowLeft') { e.preventDefault(); settle(Math.max(width - step, PANEL.MIN)) }
    if (e.key === 'ArrowRight') { e.preventDefault(); settle(width + step) }
    if (e.key === 'Enter') { e.preventDefault(); settle(0) }
  }

  return (
    <div className="relative h-full shrink-0" style={{ width }}>
      <div
        className="h-full overflow-hidden border-r border-ink/[0.06] bg-canvas"
        style={{ '--p': progress } as CSSProperties}
      >
        {/* Content never squeezes below MIN: under it, the edge clips it while the labels cascade out. */}
        <div className="h-full" style={{ width: Math.max(width, PANEL.MIN) }}>{children}</div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={0}
        aria-valuemax={PANEL.MAX}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => !dragging && setHint(null)}
        onDoubleClick={reset}
        onKeyDown={key}
        className="group absolute inset-y-0 -right-1.5 z-10 w-3 cursor-col-resize touch-none outline-none"
      >
        <span
          className={cn(
            'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-[background-color,width] duration-150',
            dragging ? 'w-0.5 bg-slate-500' : 'bg-transparent group-hover:w-0.5 group-hover:bg-slate-400 group-focus-visible:w-0.5 group-focus-visible:bg-brand-500',
          )}
        />
        {(hint != null || dragging) && (
          <span
            className="pointer-events-none absolute left-4 -translate-y-1/2 animate-fade-in rounded-md border border-ink/[0.08] bg-raised px-2 py-1 text-[11px] whitespace-nowrap text-slate-600 shadow-sm"
            style={{ top: hint ?? 0 }}
          >
            {width < PANEL.SNAP ? 'Release to collapse' : 'Drag to resize sidebar'}
          </span>
        )}
      </div>
    </div>
  )
}

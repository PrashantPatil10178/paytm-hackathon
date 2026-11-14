import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/* ───────────── API client ─────────────
   Every screen talks to "/api/*". Each app's Bun server proxies that to the
   mock API (API_URL), so the browser never needs CORS. */

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiRequestError(data?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
};

/* ───────────── Polling ─────────────
   The guide asks for a 2 s refresh on list pages so agent changes show up live.
   Identical payloads keep the same object so React skips the re-render. */

export interface Poll<T> {
  data: T | undefined;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePoll<T>(path: string | null, intervalMs = 2000): Poll<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const last = useRef<string>("");
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const res = await fetch(`/api${p}`);
      const text = await res.text();
      if (pathRef.current !== p) return; // the user moved on while this was in flight
      if (!res.ok) {
        setError(JSON.parse(text || "{}").error ?? `Request failed (${res.status})`);
        return;
      }
      setError(null);
      if (text !== last.current) {
        last.current = text;
        setData(JSON.parse(text) as T);
      }
    } catch {
      setError("Can't reach the demo API. Start it with `bun run dev`.");
    }
  }, []);

  useEffect(() => {
    last.current = "";
    setData(undefined);
    setError(null);
    if (!path) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) await load();
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [path, intervalMs, load]);

  return { data, error, refresh: load };
}

/* ───────────── Live-arrival tracking ─────────────
   Returns the ids that appeared since the previous payload (never on first load),
   so a screen can flag work the agent just did. Each id stays "fresh" for `holdMs`. */

export function useArrivals(ids: readonly (string | number)[] | undefined, holdMs = 4000): Set<string | number> {
  const known = useRef<Set<string | number> | null>(null);
  const [fresh, setFresh] = useState<Set<string | number>>(() => new Set());

  useEffect(() => {
    if (!ids) return;
    if (!known.current) {
      known.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !known.current!.has(id));
    ids.forEach((id) => known.current!.add(id));
    if (!added.length) return;
    setFresh((prev) => new Set([...prev, ...added]));
    const t = setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev);
        added.forEach((id) => next.delete(id));
        return next;
      });
    }, holdMs);
    return () => clearTimeout(t);
  }, [ids, holdMs]);

  return fresh;
}

/** Ids whose `key` changed between payloads (e.g. a deal's stage), excluding ones in `ignore`. */
export function useChanged<T>(
  items: readonly T[] | undefined,
  id: (t: T) => string | number,
  key: (t: T) => string,
  ignore: React.RefObject<Set<string | number>>,
  holdMs = 4000,
): Set<string | number> {
  const prev = useRef<Map<string | number, string> | null>(null);
  const timers = useRef(new Map<string | number, ReturnType<typeof setTimeout>>());
  const [changed, setChanged] = useState<Set<string | number>>(() => new Set());

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!items) return;
    const next = new Map(items.map((t) => [id(t), key(t)] as const));
    const before = prev.current;
    prev.current = next;
    if (!before) return;
    const moved: (string | number)[] = [];
    for (const [k, v] of next) {
      const old = before.get(k);
      if (old !== undefined && old !== v && !ignore.current?.has(k)) moved.push(k);
    }
    ignore.current?.clear();
    if (!moved.length) return;
    setChanged((s) => new Set([...s, ...moved]));
    // One timer per item, restarted if it changes again, so a later poll never cancels an earlier clear.
    for (const m of moved) {
      clearTimeout(timers.current.get(m));
      timers.current.set(
        m,
        setTimeout(() => {
          timers.current.delete(m);
          setChanged((s) => {
            const n = new Set(s);
            n.delete(m);
            return n;
          });
        }, holdMs),
      );
    }
    // id/key are expected to be stable inline lambdas; items drives the effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  return changed;
}

/* ───────────── Tiny router ─────────────
   History-API routing without a dependency. */

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") window.addEventListener("popstate", notify);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => window.location.pathname + window.location.search;

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === snapshot()) return;
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.scrollTo({ top: 0 });
  notify();
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, snapshot, () => "/");
  const [path = "/", search = ""] = href.split("?");
  return { path, query: new URLSearchParams(search) };
}

/** Match "/tickets/:id" against a path. Returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i]!;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(b[i]!);
    else if (seg !== b[i]) return null;
  }
  return params;
}

/** Props for an <a> that routes client-side but still works with cmd-click / middle-click. */
export function linkProps(to: string) {
  return {
    href: to,
    onClick: (e: React.MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to);
    },
  };
}

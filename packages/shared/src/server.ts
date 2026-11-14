import { join } from "node:path";
import type { HTMLBundle } from "bun";

/**
 * Serves one demo screen with Bun's built-in HTML bundler (no Vite, no config):
 *  - "/api/*"  → proxied to the mock API, so the browser never needs CORS
 *  - "/static/<file>" → files from the app's public/ folder
 *  - everything else → the single-page app (client-side routing)
 */
export function serveApp(opts: {
  name: string;
  port: number;
  html: HTMLBundle;
  /** absolute path to a folder served at /static */
  publicDir?: string;
}) {
  const apiUrl = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  const port = Number(process.env.PORT ?? opts.port);
  const dev = process.env.NODE_ENV !== "production";

  async function proxy(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const target = apiUrl + url.pathname.replace(/^\/api/, "") + url.search;
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    try {
      const res = await fetch(target, {
        method: req.method,
        headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
        body: hasBody ? await req.arrayBuffer() : undefined,
      });
      return new Response(res.body, {
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
      });
    } catch {
      return Response.json({ error: `The demo API isn't running at ${apiUrl}.` }, { status: 502 });
    }
  }

  const SAFE_FILE = /^[\w-]+\.(jpe?g|png|svg|webp|ico)$/;

  const server = Bun.serve({
    port,
    development: dev ? { hmr: true, console: true } : false,
    routes: {
      "/api/*": proxy,
      "/static/:file": (req) => {
        const file = req.params.file;
        if (!opts.publicDir || !SAFE_FILE.test(file)) return new Response("Not found", { status: 404 });
        const f = Bun.file(join(opts.publicDir, file));
        return f.exists().then((ok) =>
          ok
            ? new Response(f, { headers: { "cache-control": "public, max-age=3600" } })
            : new Response("Not found", { status: 404 }),
        );
      },
      "/*": opts.html,
    },
  });

  console.log(`${opts.name} ready on ${server.url} (API → ${apiUrl})`);
  return server;
}

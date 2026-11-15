/**
 * ShopKart's business policies (the demo API's `GET /policies`, 17 policies / ~73 rules), shared by every agent:
 * - `digest()`: one line per policy (code, title, summary), appended to every agent's instructions through
 *   `withPolicies`, so each agent always knows which policies exist and their headline numbers.
 * - `lookup()`: the exact rules (conditions, effect, numbers, approver) and the customer wording, behind the
 *   `lookup_policies` tool (tools/policies.ts) for the agents that act.
 * Policies inform the agents; the hard money rules (refund limit, approvals) still live in code and tools.
 * Cached for a minute; if the API can't be reached the agents run without the digest rather than failing.
 */
import type { PolicyWithRules } from "@ph/shared";
import type { DynamicValue } from "@voltagent/core";

export type PolicyBook = ReturnType<typeof createPolicyBook>;

const CACHE_MS = 60_000;

export function createPolicyBook(baseUrl: string, fetchImpl: typeof fetch = fetch, log: Pick<Console, "warn"> = console) {
  let cache: { at: number; list: PolicyWithRules[] } | null = null;

  async function all(): Promise<PolicyWithRules[]> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.list;
    try {
      const res = await fetchImpl(`${baseUrl}/policies`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { policies } = (await res.json()) as { policies: PolicyWithRules[] };
      cache = { at: Date.now(), list: policies };
    } catch (e) {
      log.warn(`[agent] couldn't load the policies: ${(e as Error).message}`);
      if (!cache) return [];
      cache = { ...cache, at: Date.now() - CACHE_MS + 10_000 }; // keep the last copy, retry in 10 s
    }
    return cache.list;
  }

  /** One line per active policy. Small enough for every prompt (~17 lines). */
  async function digest(): Promise<string> {
    const list = await all();
    return list.map((p) => `- ${p.code} ${p.title} (${p.area}): ${p.summary}`).join("\n");
  }

  /** Policies matching an area, a code or words (any word matches, best first), rendered for a model. */
  async function lookup({ area, code, query }: { area?: string; code?: string; query?: string }): Promise<string> {
    let list = await all();
    if (!list.length) return "The policy book can't be reached right now. Don't promise anything a policy would decide; hand it to a person.";
    if (code) list = list.filter((p) => p.code === code.toUpperCase() || p.rules.some((r) => r.code === code.toUpperCase()));
    if (area) list = list.filter((p) => p.area === area);
    const words = (query ?? "").toLowerCase().match(/[a-z0-9₹]{3,}/g) ?? [];
    if (words.length) {
      const scored = list
        .map((p) => {
          const text = [p.code, p.area, p.title, p.summary, p.customer_text, ...p.rules.flatMap((r) => [r.code, r.title, r.description, JSON.stringify(r.conditions)])]
            .join(" ")
            .toLowerCase();
          return [p, words.filter((w) => text.includes(w)).length] as const;
        })
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]);
      list = scored.map(([p]) => p);
    }
    if (!list.length) return "No policy matches that. Policies cover: " + [...new Set((await all()).map((p) => p.area))].join(", ") + ".";
    return list.slice(0, 4).map(render).join("\n\n");
  }

  return { all, digest, lookup };
}

function render(p: PolicyWithRules): string {
  const rules = p.rules.map((r) => {
    const when = Object.entries(r.conditions)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : v}`)
      .join(", ");
    const nums = Object.entries(r.params)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : v}`)
      .join(", ");
    return `  • ${r.code} [${r.effect}${r.approver ? ` → ${r.approver}` : ""}] ${r.title}: ${r.description}${when ? ` (when ${when})` : ""}${nums ? ` {${nums}}` : ""}`;
  });
  return [`${p.code} · ${p.title} (${p.area}, v${p.version}, owner ${p.owner})`, `Summary: ${p.summary}`, `Customer wording: ${p.customer_text}`, "Rules (lower runs first):", ...rules].join("\n");
}

/**
 * An agent's instructions with the policy digest appended. Without a book (tests) they stay a plain string.
 * `withTool` says whether this agent can call lookup_policies for the exact rules.
 */
export function withPolicies(instructions: string, book: PolicyBook | undefined, withTool = true): string | DynamicValue<string> {
  if (!book) return instructions;
  return async () => {
    const digest = await book.digest();
    if (!digest) return instructions;
    return `${instructions}

ShopKart's policies (the store's rulebook, one line each)${withTool ? `. Before you promise, refuse or decide anything a policy covers (returns, refunds, damage, delivery, payments, fees, timelines, bulk pricing), call lookup_policies for the exact rule and use its customer wording` : ". Stay consistent with them"}:
${digest}
Policies never override the hard limits your tools enforce (refund limit, approvals): when they differ, the tool wins.`;
  };
}

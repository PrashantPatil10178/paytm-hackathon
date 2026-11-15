/**
 * ShopKart's business policies (`policies` + `policy_rules`, seeded by `ensurePolicies`), read by every agent:
 * the VoltAgent agents through their platform client, Ask Aria through the Control Room, people through the
 * Control Room's Policies page. Read-only here: policies are edited in the database.
 *
 * jsonb note (see CLAUDE.md): rows written through Drizzle on Bun's driver may hold a JSON *string*; `obj()`
 * turns either shape into an object so callers always get real objects.
 */
import type { Policy, PolicyArea, PolicyEffect, PolicyRule, PolicyWithRules } from "@ph/shared";
import { asc, eq, schema as s } from "@ph/db";
import { db } from "./db.ts";
import { handle, notFound, ok } from "./http.ts";

function obj<T extends object>(v: unknown): T {
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return (parsed && typeof parsed === "object" ? parsed : {}) as T;
    } catch {
      return {} as T;
    }
  }
  return (v && typeof v === "object" ? v : {}) as T;
}

type PolicyRow = typeof s.policies.$inferSelect;
type RuleRow = typeof s.policyRules.$inferSelect;

const toRule = (r: RuleRow): PolicyRule => ({ ...r, conditions: obj(r.conditions), params: obj(r.params) });

const toPolicy = (p: PolicyRow, rules: RuleRow[]): PolicyWithRules => ({
  ...p,
  effective_from: p.effective_from.toISOString().slice(0, 10),
  updated_at: p.updated_at.toISOString(),
  rules: rules.filter((r) => r.policy_code === p.code).sort((a, b) => a.priority - b.priority).map(toRule),
});

/** Every active policy with its active rules. 17 policies / ~73 rules: two queries, filtered in memory. */
export async function listPolicies(filter: { area?: string | null; q?: string | null; effect?: string | null; includeInactive?: boolean } = {}) {
  const [policies, rules] = await Promise.all([
    db.select().from(s.policies).orderBy(asc(s.policies.area), asc(s.policies.code)),
    db.select().from(s.policyRules),
  ]);
  const live = (p: PolicyRow) => filter.includeInactive || p.status === "active";
  const liveRule = (r: RuleRow) => filter.includeInactive || r.active;
  let out = policies.filter(live).map((p) => toPolicy(p, rules.filter(liveRule)));
  if (filter.area) out = out.filter((p) => p.area === (filter.area as PolicyArea));
  if (filter.effect) out = out.map((p) => ({ ...p, rules: p.rules.filter((r) => r.effect === (filter.effect as PolicyEffect)) })).filter((p) => p.rules.length);
  const words = (filter.q ?? "").toLowerCase().match(/[a-z0-9₹]{3,}/g) ?? [];
  if (words.length) {
    const score = (p: PolicyWithRules) => {
      const text = [p.code, p.area, p.title, p.summary, p.customer_text, ...p.rules.flatMap((r) => [r.code, r.title, r.description, JSON.stringify(r.conditions)])]
        .join(" ")
        .toLowerCase();
      return words.filter((w) => text.includes(w)).length;
    };
    out = out
      .map((p) => [p, score(p)] as const)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([p]) => p);
  }
  return out;
}

export const policyRoutes = {
  /** `?area=refunds` · `?q=damaged photo` (any word matches; best first) · `?effect=approval` · `?all=1` includes drafts and retired */
  "/policies": {
    GET: handle(async (req) => {
      const q = new URL(req.url).searchParams;
      const policies = await listPolicies({ area: q.get("area"), q: q.get("q"), effect: q.get("effect"), includeInactive: q.get("all") === "1" });
      return ok({ policies });
    }),
  },
  "/policies/:code": {
    GET: handle(async (req) => {
      const code = String(req.params.code).toUpperCase();
      const [p] = await db.select().from(s.policies).where(eq(s.policies.code, code));
      if (!p) throw notFound(`Policy ${code}`);
      const rules = await db.select().from(s.policyRules).where(eq(s.policyRules.policy_code, code));
      return ok(toPolicy(p, rules) satisfies Policy);
    }),
  },
};

import { expect, test } from "bun:test";
import type { PolicyWithRules } from "@ph/shared";
import { createPolicyBook, withPolicies } from "../src/policies.ts";
import { policyTools } from "../src/tools/policies.ts";

const POLICIES: PolicyWithRules[] = [
  {
    code: "POL-RET",
    area: "returns",
    title: "Returns",
    summary: "Fashion 30 days, Home 10 days.",
    customer_text: "Most items can be returned within 10 to 30 days.",
    owner: "Customer Experience",
    version: 4,
    status: "active",
    effective_from: "2026-10-01",
    updated_at: "2026-10-01T00:00:00.000Z",
    rules: [
      { code: "RET-WINDOW-FASHION", policy_code: "POL-RET", title: "Fashion: 30-day returns", description: "Unworn, tags attached.", conditions: { categories: ["Fashion"] }, effect: "allow", params: { window_days: 30 }, approver: null, priority: 10, active: true },
    ],
  },
  {
    code: "POL-DMG",
    area: "damaged_items",
    title: "Damaged items",
    summary: "Report within 48 hours; photo above ₹1,000.",
    customer_text: "Tell us within 48 hours of delivery.",
    owner: "Customer Experience",
    version: 3,
    status: "active",
    effective_from: "2026-09-14",
    updated_at: "2026-09-14T00:00:00.000Z",
    rules: [
      { code: "DMG-PHOTO", policy_code: "POL-DMG", title: "Photo above ₹1,000", description: "Ask for a photo.", conditions: { min_amount: 1001 }, effect: "require", params: {}, approver: null, priority: 10, active: true },
    ],
  },
];

let calls = 0;
const fakeFetch = (async () => {
  calls++;
  return Response.json({ policies: POLICIES });
}) as unknown as typeof fetch;
const quiet = { warn() {} };

test("policies: every agent's instructions get the one-line digest", async () => {
  const instructions = withPolicies("You are Aria.", createPolicyBook("http://demo", fakeFetch, quiet));
  expect(typeof instructions).toBe("function");
  const text = await (instructions as () => Promise<string>)();
  expect(text).toStartWith("You are Aria.");
  expect(text).toContain("- POL-RET Returns (returns): Fashion 30 days, Home 10 days.");
  expect(text).toContain("lookup_policies");
  // Without a book (tests, no API) the instructions stay a plain string.
  expect(withPolicies("You are Aria.", undefined)).toBe("You are Aria.");
});

test("policies: lookup finds by words and code, and is cached", async () => {
  calls = 0;
  const book = createPolicyBook("http://demo", fakeFetch, quiet);
  const damaged = await book.lookup({ query: "damaged photo" });
  expect(damaged).toStartWith("POL-DMG · Damaged items");
  expect(damaged).toContain("DMG-PHOTO [require]");
  expect(damaged).not.toContain("POL-RET");
  expect(await book.lookup({ code: "RET-WINDOW-FASHION" })).toContain("{window_days=30}");
  expect(await book.lookup({ query: "warranty" })).toContain("No policy matches");
  expect(calls).toBe(1);
});

test("policies: an unreachable API never breaks an agent", async () => {
  const down = (async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;
  const book = createPolicyBook("http://demo", down, quiet);
  expect(await book.digest()).toBe("");
  expect(await (withPolicies("Base.", book) as () => Promise<string>)()).toBe("Base.");
  expect(await book.lookup({ query: "returns" })).toContain("can't be reached");
});

test("policies: lookup_policies records which policies were read", async () => {
  const steps: string[] = [];
  const [tool] = policyTools(createPolicyBook("http://demo", fakeFetch, quiet), async (_opts, detail) => {
    steps.push(detail);
  });
  const out = await tool!.execute!({ area: "returns" } as never, undefined as never);
  expect(String(out)).toContain("POL-RET · Returns");
  expect(steps).toEqual(["POL-RET Returns (looked up returns)"]);
});

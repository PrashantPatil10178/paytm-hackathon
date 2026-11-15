/** `lookup_policies`: every acting agent's read access to ShopKart's policy book (see ../policies.ts). */
import { createTool, type ToolExecuteOptions } from "@voltagent/core";
import { z } from "zod";
import type { PolicyBook } from "../policies.ts";

const AREAS = [
  "returns",
  "refunds",
  "damaged_items",
  "cancellations",
  "shipping",
  "payments",
  "cod",
  "warranty",
  "exchanges",
  "address_changes",
  "price_protection",
  "compensation",
  "fraud",
  "service_levels",
  "privacy",
  "store_credit",
  "bulk_orders",
] as const;

/** `record` (optional) logs each lookup as a step on the request's run, so the Control Room shows which policies were read. */
export function policyTools(book: PolicyBook | undefined, record?: (opts: ToolExecuteOptions | undefined, detail: string) => Promise<void>) {
  if (!book) return [];
  return [
    createTool({
      name: "lookup_policies",
      description:
        "Read ShopKart's business policies: the exact rules (when they apply, what is allowed, limits, windows, fees, who approves) and the wording customers may be told. Search by area, a policy or rule code, or words.",
      parameters: z.object({
        area: z.enum(AREAS).optional().describe("Policy area, e.g. refunds, damaged_items, shipping, bulk_orders"),
        code: z.string().optional().describe('A policy code like "POL-REF" or a rule code like "REF-AUTO-AI"'),
        query: z.string().optional().describe('Words to search for, e.g. "damaged photo electronics"'),
      }),
      execute: async (args, opts) => {
        const text = await book.lookup(args);
        if (record) {
          const codes = [...text.matchAll(/^(POL-[A-Z]+) · ([^(]+)/gm)].map((m) => `${m[1]} ${m[2]!.trim()}`);
          const asked = [args.code, args.area, args.query && `"${args.query}"`].filter(Boolean).join(", ");
          await record(opts, `${codes.length ? codes.join("; ") : "No matching policy"}${asked ? ` (looked up ${asked})` : ""}`).catch(() => {});
        }
        return text;
      },
    }),
  ];
}

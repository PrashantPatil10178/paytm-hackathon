/**
 * Which of a customer's orders a chat message names, by order number or by item ("the mugs", "my
 * headphones"). The agent and the stand-in use it so that Aria never picks an order for a refund or a
 * change on her own: only an order the customer named (or their only order) can be acted on.
 */
import type { Order } from "./types.ts";

/** Words in item names that don't identify an item on their own (colours, sizes, marketing words). */
const GENERIC = new Set(["set", "of", "and", "with", "the", "white", "black", "blue", "red", "classic", "minimal", "everyday", "over", "ear", "pack", "ml", "new"]);

/** "Mugs" → "mug", "T-shirt" → "tshirt": lower case, no hyphens, one plural "s" off ("glasses" → "glasse"). */
const stem = (w: string) => {
  const x = w.toLowerCase().replace(/-/g, "");
  return x.length > 3 && x.endsWith("s") && !x.endsWith("ss") ? x.slice(0, -1) : x;
};
const words = (text: string) => text.toLowerCase().replace(/(\w)-(\w)/g, "$1$2").match(/[a-z]+/g)?.map(stem) ?? [];

/** Where in `text` an order is named (its number, or a word of one of its items), or -1. */
function position(text: string, o: Order): number {
  const byId = text.search(new RegExp(`(^|\\D)${o.id}(\\D|$)`));
  if (byId >= 0) return byId;
  const keys = new Set(o.items.flatMap((i) => words(i.name)).filter((k) => k.length >= 3 && !GENERIC.has(k)));
  const tokens = words(text);
  // A word matches an item word exactly, or is the end of a longer one ("watch" in "smartwatch", "glasse" in "sunglasse").
  const hit = tokens.findIndex((t) => keys.has(t) || (t.length >= 5 && [...keys].some((k) => k.endsWith(t))));
  return hit < 0 ? -1 : 10_000 + hit; // after any order number, in the order the words appear
}

/** The customer's orders that `text` names, in the order they are mentioned. */
export function ordersNamedIn<O extends Order>(text: string, orders: O[]): O[] {
  return orders
    .map((o) => ({ o, at: position(text, o) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.o);
}

/** Orders that a refund, cancellation or change could still be about (not already refunded). */
export const liveOrders = <O extends Order>(orders: O[]) => orders.filter((o) => o.payment_status !== "refunded" && o.payment_status !== "refund_initiated");

/** "#1023 (Stoneware Coffee Mugs, Set of 2, damaged)" */
export function orderChoice(o: Order): string {
  const first = o.items[0]?.name ?? "items";
  const more = o.items.length > 1 ? ` + ${o.items.length - 1} more` : "";
  return `#${o.id} (${first}${more}, ${o.status})`;
}

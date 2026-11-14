const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** ₹1,20,000 (Indian digit grouping) */
export const rupees = (n: number) => inr.format(n);

/** ₹1.2L / ₹45K, for tight column headers */
export function rupeesShort(n: number): string {
  if (n >= 1_00_00_000) return `₹${trim(n / 1_00_00_000)}Cr`;
  if (n >= 1_00_000) return `₹${trim(n / 1_00_000)}L`;
  if (n >= 1_000) return `₹${trim(n / 1_000)}K`;
  return `₹${n}`;
}
const trim = (n: number) => (Math.round(n * 10) / 10).toString();

const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const fullFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const longDay = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" });

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Zendesk-style: "Today 15:32", "Yesterday 09:10", "12 Nov" */
export function stamp(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return `Today ${timeFmt.format(d)}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `Yesterday ${timeFmt.format(d)}`;
  return dayFmt.format(d);
}

/** "just now", "4 minutes ago", "3 hours ago", "2 days ago" */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export const fullDate = (iso: string) => fullFmt.format(new Date(iso));
export const shortDay = (iso: string) => longDay.format(new Date(iso));
export const clock = (iso: string) => timeFmt.format(new Date(iso));

/** "Ananya Iyer" → "AI"; "Priya – Support" → "PS" (name + team, like an agent badge) */
export function initials(name: string): string {
  const parts = name.split(/[\s–-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Timeline group heading: "Today", "Yesterday", or "12 Nov" */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return dayFmt.format(d);
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

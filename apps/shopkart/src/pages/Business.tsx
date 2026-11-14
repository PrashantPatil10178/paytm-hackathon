import { ENQUIRY_NEEDS, type EnquiryNeed, type LeadResponse } from "@ph/shared";
import { api } from "@ph/shared/react";
import { CircleCheck } from "lucide-react";
import { useState } from "react";

const START = ["Immediately", "This month", "In 1–3 months", "Later this year"];

const NEXT = [
  "You send this form. It takes about a minute.",
  "Someone from our business team calls or emails you within one working day.",
  "You get a plan and a quote for your counters, store or bulk order.",
];

const SAMPLE = {
  name: "Rakesh Sharma",
  phone: "+91 90000 30011",
  email: "rakesh@sharmarestaurants.example",
  business_name: "Sharma Restaurants",
  need: "billing_setup" as EnquiryNeed,
  budget: "50,000",
  start_when: "This month",
};

const EMPTY = {
  name: "",
  phone: "",
  email: "",
  business_name: "",
  need: "" as EnquiryNeed | "",
  budget: "",
  start_when: "",
};

export function Business() {
  const [form, setForm] = useState(EMPTY);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState("");

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const res = await api.post<LeadResponse>("/lead", {
        ...form,
        budget: Number(form.budget.replace(/[^\d]/g, "")) || 0,
      });
      setThanks(res.message || "Thanks! Our team will contact you shortly.");
      setState("done");
    } catch (err) {
      setError(`We couldn't send your enquiry: ${(err as Error).message}`);
      setState("idle");
    }
  };

  if (state === "done")
    return (
      <div className="wrap max-w-[640px] pt-16 text-center">
        <CircleCheck size={48} className="mx-auto text-ok" aria-hidden />
        <h1 className="mt-4 text-3xl font-extrabold">{thanks}</h1>
        <p className="mt-2 text-ink-2">
          We've got the details for {form.business_name}. Expect a call or email at {form.email} within one working day.
        </p>
        <button
          type="button"
          className="btn-quiet mt-8"
          onClick={() => {
            setForm(EMPTY);
            setState("idle");
          }}
        >
          Send another enquiry
        </button>
      </div>
    );

  return (
    <div className="wrap pt-8 sm:pt-12">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <h1 className="text-[clamp(1.75rem,3.6vw,2.5rem)] leading-tight font-extrabold">Buying for your business?</h1>
          <p className="mt-3 max-w-[46ch] text-ink-2">
            Bulk orders with GST invoices, billing for your counters, or online payments for your store. Tell us what you need and our business team will
            get back with a plan and a quote.
          </p>
          <h2 className="mt-10 text-sm font-bold tracking-normal text-ink-2">What happens next</h2>
          <ol className="mt-4 grid max-w-[44ch] gap-4">
            {NEXT.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="grid size-7 flex-none place-items-center rounded-full bg-jamun-wash text-sm font-bold text-jamun tabular-nums" aria-hidden>
                  {i + 1}
                </span>
                <span className="pt-0.5 text-ink-2">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <form onSubmit={submit} className="grid gap-5 rounded-2xl border border-line p-5 sm:grid-cols-2 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 sm:col-span-2">
            <h2 className="text-xl font-bold">Tell us about your business</h2>
            <button
              type="button"
              onClick={() => setForm(SAMPLE)}
              className="-mx-2 cursor-pointer rounded-lg px-2 py-1 text-sm font-semibold text-jamun underline-offset-4 hover:underline"
            >
              Fill in sample details
            </button>
          </div>
          <Field label="Your name" htmlFor="name">
            <input id="name" className="field" required autoComplete="name" value={form.name} onChange={set("name")} />
          </Field>
          <Field label="Business name" htmlFor="business">
            <input id="business" className="field" required autoComplete="organization" value={form.business_name} onChange={set("business_name")} />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <input id="phone" className="field" required type="tel" autoComplete="tel" inputMode="tel" placeholder="+91" value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="Email" htmlFor="email">
            <input id="email" className="field" required type="email" autoComplete="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="What do you need?" htmlFor="need">
            <select id="need" className="field cursor-pointer" required value={form.need} onChange={set("need")}>
              <option value="" disabled>
                Choose one
              </option>
              {ENQUIRY_NEEDS.map((n) => (
                <option key={n.id} value={n.id}>{n.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Budget" htmlFor="budget">
            <span className="relative block">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-2" aria-hidden>₹</span>
              <input
                id="budget"
                className="field pl-8 tabular-nums"
                required
                inputMode="numeric"
                placeholder="50,000"
                value={form.budget}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^\d]/g, "").slice(0, 9);
                  setForm((f) => ({ ...f, budget: digits ? Number(digits).toLocaleString("en-IN") : "" }));
                }}
              />
            </span>
          </Field>
          <Field label="When do you want to start?" htmlFor="start" wide>
            <div id="start" role="radiogroup" aria-label="When do you want to start?" className="flex flex-wrap gap-2">
              {START.map((s) => (
                <label
                  key={s}
                  className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-2 transition-colors hover:border-ink-3 has-checked:border-jamun has-checked:bg-jamun-wash has-checked:text-jamun has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-jamun"
                >
                  <input type="radio" name="start" value={s} required checked={form.start_when === s} onChange={set("start_when")} className="sr-only" />
                  {s}
                </label>
              ))}
            </div>
          </Field>

          <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
            <button className="btn-primary" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Send enquiry"}
            </button>
            {error && (
              <p className="text-sm text-bad" role="alert">
                {error}
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, wide = false, children }: { label: string; htmlFor: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`grid content-start gap-2 ${wide ? "sm:col-span-2" : ""}`}>
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}

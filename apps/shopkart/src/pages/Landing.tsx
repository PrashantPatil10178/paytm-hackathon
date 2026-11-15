import { ENQUIRY_NEEDS, type CampaignLanding, type EnquiryNeed } from "@ph/shared";
import { api } from "@ph/shared/react";
import { CircleCheck, Megaphone } from "lucide-react";
import { useEffect, useState } from "react";

const START = ["Immediately", "This month", "In 1–3 months", "Later this year"];

const EMPTY = { name: "", email: "", phone: "", company: "", need: "" as EnquiryNeed | "", budget: "", start_when: "", message: "", website: "" };

/**
 * A campaign's public landing page (/c/<slug>): the pitch and a short form. Each submission is a campaign response
 * that waits for the leads agent ("Fetch new leads" in the Control Room). One visit is counted per page load.
 */
export function Landing({ slug }: { slug: string }) {
  const [campaign, setCampaign] = useState<CampaignLanding | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<{ campaign: CampaignLanding }>(`/campaigns/landing/${encodeURIComponent(slug)}?visit=1`)
      .then((r) => live && setCampaign(r.campaign))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [slug]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      await api.post(`/campaigns/landing/${encodeURIComponent(slug)}/responses`, { ...form, budget: form.budget ? Number(form.budget.replace(/[^\d]/g, "")) : null });
      setState("done");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  };

  if (missing)
    return (
      <div className="wrap max-w-[640px] pt-16 text-center">
        <h1 className="text-2xl font-extrabold">This offer isn't available</h1>
        <p className="mt-2 text-ink-2">The link may be old. Our business team is still happy to help.</p>
        <a href="/business" className="btn-primary mt-6 inline-flex">Send a business enquiry</a>
      </div>
    );
  if (!campaign) return <div className="wrap pt-16 text-ink-2" aria-busy>Loading…</div>;

  if (state === "done")
    return (
      <div className="wrap max-w-[640px] pt-16 text-center">
        <CircleCheck size={48} className="mx-auto text-ok" aria-hidden />
        <h1 className="mt-4 text-3xl font-extrabold">Thanks, {form.name.split(" ")[0]}!</h1>
        <p className="mt-2 text-ink-2">
          We've got your details for {form.company}. Our business team will reach you at {form.email} within one working day.
        </p>
        <button type="button" className="btn-quiet mt-8" onClick={() => { setForm(EMPTY); setState("idle"); }}>
          Send another reply
        </button>
      </div>
    );

  const closed = campaign.status !== "active";
  return (
    <div className="wrap pt-8 sm:pt-12">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-marigold/20 px-3 py-1 text-sm font-bold text-marigold-ink">
            <Megaphone size={15} aria-hidden /> {campaign.name}
          </p>
          <h1 className="mt-4 text-[clamp(1.75rem,3.6vw,2.6rem)] leading-tight font-extrabold">{campaign.headline}</h1>
          <p className="mt-3 max-w-[48ch] text-lg text-ink-2">{campaign.pitch}</p>
          <ul className="mt-8 grid max-w-[44ch] gap-3 text-ink-2">
            {["GST invoices on every order", "A named person from our business team", "Answer within one working day"].map((x) => (
              <li key={x} className="flex items-center gap-2">
                <CircleCheck size={18} className="flex-none text-ok" aria-hidden /> {x}
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={submit} className="grid gap-5 rounded-2xl border border-line p-5 sm:grid-cols-2 sm:p-8" aria-disabled={closed}>
          <h2 className="text-xl font-bold sm:col-span-2">{closed ? "This campaign is paused" : "Get a call back"}</h2>
          {closed && <p className="text-ink-2 sm:col-span-2">It isn't taking replies right now. You can still send a <a href="/business" className="font-semibold text-jamun underline">business enquiry</a>.</p>}
          <fieldset disabled={closed} className="contents">
            <Field label="Your name" htmlFor="l-name">
              <input id="l-name" className="field" required maxLength={80} autoComplete="name" value={form.name} onChange={set("name")} />
            </Field>
            <Field label="Company" htmlFor="l-company">
              <input id="l-company" className="field" required maxLength={100} autoComplete="organization" value={form.company} onChange={set("company")} />
            </Field>
            <Field label="Email" htmlFor="l-email">
              <input id="l-email" className="field" required type="email" maxLength={120} autoComplete="email" value={form.email} onChange={set("email")} />
            </Field>
            <Field label="Phone" htmlFor="l-phone">
              <input id="l-phone" className="field" required type="tel" inputMode="tel" maxLength={20} autoComplete="tel" placeholder="+91" value={form.phone} onChange={set("phone")} />
            </Field>
            <Field label="What do you need?" htmlFor="l-need">
              <select id="l-need" className="field cursor-pointer" required value={form.need} onChange={set("need")}>
                <option value="" disabled>Choose one</option>
                {ENQUIRY_NEEDS.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
            </Field>
            <Field label="Budget (optional)" htmlFor="l-budget">
              <span className="relative block">
                <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-2" aria-hidden>₹</span>
                <input
                  id="l-budget"
                  className="field pl-8 tabular-nums"
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
            <Field label="When do you want to start?" htmlFor="l-start" wide>
              <div id="l-start" role="radiogroup" aria-label="When do you want to start?" className="flex flex-wrap gap-2">
                {START.map((s) => (
                  <label
                    key={s}
                    className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-2 transition-colors hover:border-ink-3 has-checked:border-jamun has-checked:bg-jamun-wash has-checked:text-jamun has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-jamun"
                  >
                    <input type="radio" name="l-start" value={s} checked={form.start_when === s} onChange={set("start_when")} className="sr-only" />
                    {s}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Anything else? (optional)" htmlFor="l-message" wide>
              <textarea id="l-message" className="field min-h-24 py-3" maxLength={1000} value={form.message} onChange={set("message")} placeholder="Quantities, locations, what you use today…" />
            </Field>
            {/* Honeypot: hidden from people (and screen readers); bots fill it in. */}
            <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden>
              <label htmlFor="l-website">Website</label>
              <input id="l-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
            </div>
            <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
              <button className="btn-primary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Request a call back"}</button>
              {error && <p className="text-sm text-bad" role="alert">{error}</p>}
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, wide = false, children }: { label: string; htmlFor: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`grid content-start gap-2 ${wide ? "sm:col-span-2" : ""}`}>
      <label htmlFor={htmlFor} className="text-sm font-semibold">{label}</label>
      {children}
    </div>
  );
}

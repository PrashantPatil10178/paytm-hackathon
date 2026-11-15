import { ChevronDown } from "lucide-react";
import { useEffect } from "react";
import { ChatPanel } from "../components/Chat.tsx";
import { useChat } from "../store.tsx";

const FAQ = [
  {
    q: "What is the refund policy?",
    a: "If an item arrives damaged or isn't what you ordered, tell us within 7 days of delivery. Refunds up to ₹1,000 are approved straight away; larger ones are checked by our team within a day. The money goes back to your original payment method in 3–5 working days.",
  },
  {
    q: "How long does delivery take?",
    a: "Metro cities get orders in 2–3 days and the rest of India in 4–6 days. You'll get a tracking link by SMS as soon as your order ships.",
  },
  {
    q: "How do I return something?",
    a: "Open My Orders, pick the order and tap Need help?. We'll book a free pickup. Items need to be unused and in their original packaging.",
  },
  {
    q: "My payment failed but money was debited. What now?",
    a: "Banks usually reverse failed payments within 48 hours on their own. If it's been longer, or the amount is large, message us here and a person from our payments team will check it the same day.",
  },
  {
    q: "Can I change my delivery address?",
    a: "Yes, until the order ships. After that, we can ask the courier to hold it at your nearest hub for 3 days.",
  },
];

export function Help() {
  const { setInlineMounted, setOpen } = useChat();

  useEffect(() => {
    setInlineMounted(true);
    setOpen(false);
    return () => setInlineMounted(false);
  }, [setInlineMounted, setOpen]);

  return (
    <div className="wrap pt-8 sm:pt-12">
      <h1 className="text-[clamp(1.75rem,3.6vw,2.5rem)] leading-tight font-extrabold">Help</h1>
      <p className="mt-1 max-w-[60ch] text-ink-2">Quick answers below. For anything about a specific order, chat with us. Replies come in seconds.</p>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="faq-title">
          <h2 id="faq-title" className="sr-only">Frequently asked questions</h2>
          <div className="divide-y divide-line rounded-2xl border border-line">
            {FAQ.map((f, i) => (
              <details key={f.q} className="group px-5" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown size={18} className="flex-none text-ink-3 transition-transform duration-200 group-open:rotate-180" aria-hidden />
                </summary>
                <p className="max-w-[65ch] pb-5 text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="h-[600px] overflow-clip rounded-2xl border border-line shadow-[var(--shadow-lift)] lg:sticky lg:top-24" aria-label="Chat with support">
          <ChatPanel />
        </section>
      </div>
    </div>
  );
}

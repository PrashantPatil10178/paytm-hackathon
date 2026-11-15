import type { ChatAnswer, ChatMessage as StoredMessage, ChatQuestion, ChatResponse, ChatTranscript, Customer } from "@ph/shared";
import { api, usePoll } from "@ph/shared/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** A message id. crypto.randomUUID only exists on secure pages (https or localhost), not when the shop is
 *  opened over the network by IP, so fall back to getRandomValues, which works everywhere. */
const uid = (): string =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/* ───────────── Logged-in customer (demo switcher) ───────────── */

const STORAGE_KEY = "shopkart.customer";
const DEFAULT_CUSTOMER = 102; // Ananya: owns order #1023, the refund demo

function readStored(): number {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || DEFAULT_CUSTOMER;
  } catch {
    return DEFAULT_CUSTOMER;
  }
}

interface CustomerCtx {
  customers: Customer[] | undefined;
  customer: Customer | undefined;
  setCustomerId: (id: number) => void;
  cartCount: number;
  addToCart: () => void;
}

const CustomerContext = createContext<CustomerCtx | null>(null);

export function useCustomer() {
  const ctx = useContext(CustomerContext);
  if (!ctx) throw new Error("useCustomer outside CustomerProvider");
  return ctx;
}

/* ───────────── Support chat (shared by the floating widget and the Help page) ───────────── */

export interface ChatMessage {
  id: string;
  /** "system" = a centred notice, like WhatsApp's "Messages are end-to-end encrypted" pill; "agent" = a person on the team */
  from: "me" | "bot" | "agent" | "system";
  text: string;
  at: Date;
  /** Who wrote it, for a person on the team */
  author?: string;
  failed?: boolean;
  /** Aria asked the customer to pick something (which order); the chat shows it as a card under the bubble. */
  ask?: ChatQuestion;
  /** What the customer answered; once set the card is closed. Typing something else instead dismisses it. */
  answered?: string;
}

interface ChatCtx {
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: ChatMessage[];
  typing: boolean;
  /** A person from the team is on this chat (they took it over from Aria) */
  agent: string | null;
  /** Replies arrived while the widget was closed */
  unread: number;
  draft: string;
  setDraft: (d: string) => void;
  /** Send a message. With `answer`, it answers the open question card. */
  send: (text: string, answer?: Omit<ChatAnswer, "original" | "kind">) => Promise<void>;
  /** Open the widget with a message about this order ready to send */
  askAbout: (orderId: number) => void;
  inlineMounted: boolean;
  setInlineMounted: (v: boolean) => void;
}

const ChatContext = createContext<ChatCtx | null>(null);

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat outside ShopProvider");
  return ctx;
}

/**
 * A typed reply to an open question, if it is one: an order number ("1047", "#1047", "order 1047") or the
 * name of one of the products offered. Returns null for anything else (the customer moved on).
 */
function typedAnswer(text: string, ask: ChatQuestion): { value: string | null; text: string } | null {
  const num = text.match(/#?\s*(\d{3,})/)?.[1];
  if (num) return { value: ask.choices.find((c) => c.value === num)?.value ?? null, text };
  const t = text.toLowerCase();
  const hits = ask.choices.filter((c) => c.label.toLowerCase().split(/[^a-z]+/).some((w) => w.length >= 4 && t.includes(w)));
  const orders = new Set(hits.map((c) => c.value));
  return orders.size === 1 ? { value: hits[0]!.value, text } : null;
}

const newSession = (customerId: number) => `shopkart-${customerId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** One chat per customer, kept across reloads like a messaging app: the conversation itself is stored by the API. */
function sessionFor(customerId: number): string {
  const key = `shopkart.chat.${customerId}`;
  try {
    const known = localStorage.getItem(key);
    if (known) return known;
    const id = newSession(customerId);
    localStorage.setItem(key, id);
    return id;
  } catch {
    return newSession(customerId); // private mode: a chat for this tab only
  }
}

const greeting = (name?: string): ChatMessage => ({
  id: "hello",
  from: "bot",
  text: `Hi${name ? ` ${name.split(" ")[0]}` : ""}! I'm the ShopKart assistant. Ask me about an order, a refund or a payment.`,
  at: new Date(0),
});

const FROM: Record<StoredMessage["sender"], ChatMessage["from"]> = { customer: "me", ai: "bot", human: "agent", system: "system" };

/** The stored conversation as bubbles. A question card counts as answered once the customer wrote after it. */
function bubbles(stored: StoredMessage[]): ChatMessage[] {
  return stored.map((m, i) => {
    const next = m.ask ? stored.slice(i + 1).find((x) => x.sender === "customer") : undefined;
    return {
      id: String(m.id),
      from: FROM[m.sender],
      text: m.body,
      at: new Date(m.created_at),
      ...(m.sender === "human" && { author: m.author }),
      ...(m.ask && { ask: m.ask, ...(next && { answered: next.answer?.text ?? "" }) }),
    };
  });
}

/** Messages only this tab has: one being sent, or a failed send. `after` = the newest stored message id when it was made. */
interface Local {
  m: ChatMessage;
  after: number;
}

export function ShopProvider({ children }: { children: React.ReactNode }) {
  const list = usePoll<{ customers: Customer[] }>("/shop/customers", 30_000);
  const [customerId, setId] = useState(readStored);
  const [cartCount, setCart] = useState(0);
  const customers = list.data?.customers;
  const customer = customers?.find((c) => c.id === customerId) ?? customers?.[0];

  const setCustomerId = useCallback((id: number) => {
    setId(id);
    setCart(0);
    try {
      localStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      /* private mode: the switch still works for this tab */
    }
  }, []);

  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [inlineMounted, setInlineMounted] = useState(false);
  const [locals, setLocals] = useState<Local[]>([]);
  const session = useMemo(() => (customer ? sessionFor(customer.id) : null), [customer?.id]);
  const transcript = usePoll<ChatTranscript>(session ? `/chat/sessions/${encodeURIComponent(session)}` : null, 2000);
  const stored = transcript.data?.session_id === session ? transcript.data.messages : undefined;
  const lastId = stored?.at(-1)?.id ?? 0;

  useEffect(() => {
    setDraft("");
    setTyping(false);
    setLocals([]);
  }, [customer?.id]);

  // Stored messages, with this tab's own in place. A message being sent shows until the stored copy arrives.
  const messages = useMemo(() => {
    const list = stored ?? [];
    const sent = (l: Local) => l.m.from === "me" && list.some((x) => x.id > l.after && x.sender === "customer" && x.body === l.m.text);
    const mine = locals.filter((l) => !sent(l));
    const out: ChatMessage[] = [greeting(customer?.name), ...mine.filter((l) => l.after === 0).map((l) => l.m)];
    for (const m of bubbles(list)) {
      out.push(m);
      out.push(...mine.filter((l) => String(l.after) === m.id).map((l) => l.m));
    }
    const placed = new Set(out);
    out.push(...mine.map((l) => l.m).filter((m) => !placed.has(m)));
    return out;
  }, [stored, locals, customer?.name]);

  const send = useCallback(
    async (text: string, picked?: Omit<ChatAnswer, "original" | "kind">) => {
      const msg = text.trim();
      if (!msg || !customer || !session) return;
      // An open question card: a pick from it, or a typed order number / product name, answers it.
      // Anything else typed is a new message, and the card closes unanswered.
      const card = [...messages].reverse().find((m) => m.ask && m.answered === undefined);
      let answer: ChatAnswer | undefined;
      if (card?.ask) {
        const typed = picked ?? typedAnswer(msg, card.ask);
        if (typed) answer = { kind: card.ask.kind, original: card.ask.original, ...typed };
      }
      const after = lastId;
      setLocals((l) => [...l, { m: { id: uid(), from: "me", text: msg, at: new Date() }, after }]);
      setDraft("");
      setTyping(true);
      try {
        await api.post<ChatResponse>("/chat", { session_id: session, customer_id: customer.id, message: msg, ...(answer && { answer }) });
      } catch (e) {
        // After whatever of this turn was stored (usually the customer's message).
        const now = await api.get<ChatTranscript>(`/chat/sessions/${encodeURIComponent(session)}`).catch(() => null);
        const at = now?.messages.at(-1)?.id ?? after;
        setLocals((l) => [
          ...l,
          { m: { id: uid(), from: "bot", text: `I couldn't get an answer just now (${(e as Error).message}). Please send that again.`, at: new Date(), failed: true }, after: at },
        ]);
      } finally {
        await transcript.refresh();
        setTyping(false);
      }
    },
    [customer, session, messages, lastId, transcript],
  );

  // Unread: replies (Aria finishing later, a person on the team) that came in while the widget was closed.
  const [seen, setSeen] = useState(0);
  const visible = open || inlineMounted;
  useEffect(() => {
    if (visible && lastId > seen) setSeen(lastId);
  }, [visible, lastId, seen]);
  useEffect(() => setSeen(0), [session]);
  const unread = visible || !seen ? 0 : (stored ?? []).filter((m) => m.id > seen && m.sender !== "customer" && m.sender !== "system").length;

  const askAbout = useCallback((orderId: number) => {
    setDraft(`I need help with order #${orderId}. `);
    setOpen(true);
  }, []);

  const customerValue = useMemo<CustomerCtx>(
    () => ({ customers, customer, setCustomerId, cartCount, addToCart: () => setCart((n) => n + 1) }),
    [customers, customer, setCustomerId, cartCount],
  );

  const chatValue: ChatCtx = {
    open,
    setOpen,
    messages,
    typing,
    agent: transcript.data?.session_id === session ? transcript.data.agent : null,
    unread,
    draft,
    setDraft,
    send,
    askAbout,
    inlineMounted,
    setInlineMounted,
  };

  return (
    <CustomerContext.Provider value={customerValue}>
      <ChatContext.Provider value={chatValue}>{children}</ChatContext.Provider>
    </CustomerContext.Provider>
  );
}

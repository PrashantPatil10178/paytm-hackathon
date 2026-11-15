import type { AnswerInfoRequestResponse, ChatResponse, Customer, InfoRequest, Ticket } from "@ph/shared";
import { api, usePoll } from "@ph/shared/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

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
  /**
   * "system" = a centred notice, like WhatsApp's "Messages are end-to-end encrypted" pill · "team" = a reply a
   * support person wrote on the ticket · "form" = a request form (`requestId`) the customer fills in here
   */
  from: "me" | "bot" | "team" | "system" | "form";
  text: string;
  at: Date;
  failed?: boolean;
  /** team: who wrote it */
  author?: string;
  /** form: the request it shows */
  requestId?: number;
  /** me: a photo sent with a form */
  image?: string;
}

interface Thread {
  session: string;
  messages: ChatMessage[];
  ticketId?: number;
  startedAt: number;
  /** Request forms and team replies already in `messages` */
  seen: Set<string>;
}

interface ChatCtx {
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: ChatMessage[];
  typing: boolean;
  draft: string;
  setDraft: (d: string) => void;
  send: (text: string) => Promise<void>;
  /** Live request forms sent into this chat, by id */
  requests: Record<number, InfoRequest>;
  /** Sends a form's answers. Resolves to an error message, or null when sent. */
  answer: (requestId: number, answers: Record<string, string>) => Promise<string | null>;
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

const newSession = (customerId: number) => `shopkart-${customerId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const greeting = (name?: string): ChatMessage => ({
  id: "hello",
  from: "bot",
  text: `Hi${name ? ` ${name.split(" ")[0]}` : ""}! I'm the ShopKart assistant. Ask me about an order, a refund or a payment.`,
  at: new Date(),
});

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

  // One chat thread per customer, kept while you switch back and forth.
  const threads = useRef(new Map<number, Thread>());
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [inlineMounted, setInlineMounted] = useState(false);

  const thread = useMemo(() => {
    if (!customer) return undefined;
    let t = threads.current.get(customer.id);
    if (!t) {
      t = { session: newSession(customer.id), messages: [greeting(customer.name)], startedAt: Date.now(), seen: new Set() };
      threads.current.set(customer.id, t);
    }
    return t;
  }, [customer]);

  useEffect(() => {
    setDraft("");
    setTyping(false);
  }, [customer?.id]);

  const push = useCallback((t: Thread, m: ChatMessage) => {
    t.messages = [...t.messages, m];
    force((n) => n + 1);
  }, []);

  // Forms sent into this chat (by Aria or a person) and replies a person writes on the ticket arrive here.
  const ticketId = thread?.ticketId;
  const requestsPoll = usePoll<{ requests: InfoRequest[] }>(ticketId ? `/info/requests?ticket_id=${ticketId}` : null, 2500);
  const ticketPoll = usePoll<Ticket>(ticketId ? `/zendesk/tickets/${ticketId}` : null, 2500);
  const busy = useRef(false);

  const addForms = useCallback(
    (t: Thread, list: InfoRequest[] | undefined) => {
      for (const r of [...(list ?? [])].sort((a, b) => a.id - b.id)) {
        const key = `form-${r.id}`;
        if (r.status !== "waiting" || t.seen.has(key)) continue;
        t.seen.add(key);
        push(t, { id: key, from: "form", text: r.ask, at: new Date(r.created_at), requestId: r.id });
      }
    },
    [push],
  );

  useEffect(() => {
    // While a message is in flight its reply comes first; send() adds any form after it.
    if (thread && !busy.current) addForms(thread, requestsPoll.data?.requests);
  }, [thread, requestsPoll.data, addForms]);

  useEffect(() => {
    if (!thread) return;
    for (const c of ticketPoll.data?.comments ?? []) {
      const key = `comment-${c.id}`;
      if (!c.public || c.author_type !== "agent" || thread.seen.has(key) || Date.parse(c.created_at) < thread.startedAt) continue;
      thread.seen.add(key);
      push(thread, { id: key, from: "team", author: c.author, text: c.body, at: new Date(c.created_at) });
    }
  }, [thread, ticketPoll.data, push]);

  const send = useCallback(
    async (text: string, image?: string) => {
      const msg = text.trim();
      if (!msg || !customer || !thread) return;
      push(thread, { id: crypto.randomUUID(), from: "me", text: msg, at: new Date(), ...(image && { image }) });
      setDraft("");
      setTyping(true);
      busy.current = true;
      try {
        const res = await api.post<ChatResponse>("/chat", { session_id: thread.session, customer_id: customer.id, message: msg });
        if (res.ticket_id && res.ticket_id !== thread.ticketId) {
          thread.ticketId = res.ticket_id;
          push(thread, { id: crypto.randomUUID(), from: "system", text: `Ticket #${res.ticket_id} opened with ShopKart support`, at: new Date() });
        }
        push(thread, { id: crypto.randomUUID(), from: "bot", text: res.reply, at: new Date() });
        // A form Aria sent while answering goes right under her reply.
        if (res.ticket_id) {
          const { requests } = await api.get<{ requests: InfoRequest[] }>(`/info/requests?ticket_id=${res.ticket_id}&status=waiting`).catch(() => ({ requests: [] }));
          addForms(thread, requests);
        }
      } catch (e) {
        push(thread, {
          id: crypto.randomUUID(),
          from: "bot",
          text: `I couldn't get an answer just now (${(e as Error).message}). Please send that again.`,
          at: new Date(),
          failed: true,
        });
      } finally {
        busy.current = false;
        setTyping(false);
      }
    },
    [customer, thread, push, addForms],
  );

  const answer = useCallback(
    async (requestId: number, answers: Record<string, string>): Promise<string | null> => {
      if (!thread) return "The chat isn't ready yet.";
      let res: AnswerInfoRequestResponse;
      try {
        res = await api.post<AnswerInfoRequestResponse>(`/info/requests/${requestId}/answer`, { answers });
      } catch (e) {
        return (e as Error).message;
      }
      void requestsPoll.refresh();
      const photo = res.request.answers?.find((a) => a.value.startsWith("data:image/"))?.value;
      if (res.to_aria) {
        await send(res.summary, photo);
      } else {
        push(thread, { id: crypto.randomUUID(), from: "me", text: res.summary, at: new Date(), ...(photo && { image: photo }) });
        const who = res.request.requested_by.split(" – ")[0];
        push(thread, { id: crypto.randomUUID(), from: "system", text: `Sent to ${who}. They'll reply here.`, at: new Date() });
      }
      return null;
    },
    [thread, send, push, requestsPoll],
  );

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
    messages: thread?.messages ?? [],
    typing,
    draft,
    setDraft,
    send,
    requests: Object.fromEntries((requestsPoll.data?.requests ?? []).map((r) => [r.id, r])),
    answer,
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

import type { ChatResponse, Customer } from "@ph/shared";
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
  /** "system" = a centred notice, like WhatsApp's "Messages are end-to-end encrypted" pill */
  from: "me" | "bot" | "system";
  text: string;
  at: Date;
  failed?: boolean;
}

interface ChatCtx {
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: ChatMessage[];
  typing: boolean;
  draft: string;
  setDraft: (d: string) => void;
  send: (text: string) => Promise<void>;
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
  const threads = useRef(new Map<number, { session: string; messages: ChatMessage[]; ticketId?: number }>());
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [inlineMounted, setInlineMounted] = useState(false);

  const thread = useMemo(() => {
    if (!customer) return undefined;
    let t = threads.current.get(customer.id);
    if (!t) {
      t = { session: newSession(customer.id), messages: [greeting(customer.name)] };
      threads.current.set(customer.id, t);
    }
    return t;
  }, [customer]);

  useEffect(() => {
    setDraft("");
    setTyping(false);
  }, [customer?.id]);

  const send = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg || !customer || !thread) return;
      const push = (m: ChatMessage) => {
        thread.messages = [...thread.messages, m];
        force((n) => n + 1);
      };
      push({ id: crypto.randomUUID(), from: "me", text: msg, at: new Date() });
      setDraft("");
      setTyping(true);
      try {
        const res = await api.post<ChatResponse>("/chat", { session_id: thread.session, customer_id: customer.id, message: msg });
        if (res.ticket_id && res.ticket_id !== thread.ticketId) {
          thread.ticketId = res.ticket_id;
          push({ id: crypto.randomUUID(), from: "system", text: `Ticket #${res.ticket_id} opened with ShopKart support`, at: new Date() });
        }
        push({ id: crypto.randomUUID(), from: "bot", text: res.reply, at: new Date() });
      } catch (e) {
        push({
          id: crypto.randomUUID(),
          from: "bot",
          text: `I couldn't get an answer just now (${(e as Error).message}). Please send that again.`,
          at: new Date(),
          failed: true,
        });
      } finally {
        setTyping(false);
      }
    },
    [customer, thread],
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

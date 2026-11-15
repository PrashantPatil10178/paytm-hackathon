import type { Attachment, ChatAnswer, ChatMessage as StoredMessage, ChatQuestion, ChatResponse, ChatTranscript, Customer, UploadAttachmentsBody } from "@ph/shared";
import { ApiRequestError, api, usePoll } from "@ph/shared/react";
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
  /** A message of mine still on its way (the connection dropped and it's being resent), or that gave up after a while. */
  status?: "sending" | "unsent";
  /** Aria asked the customer to pick something (which order); the chat shows it as a card under the bubble. */
  ask?: ChatQuestion;
  /** What the customer answered; once set the card is closed. Typing something else instead dismisses it. */
  answered?: string;
  /** Photos sent with the message: stored ones (served by the API) or this tab's previews while sending */
  photos?: { src: string; alt: string }[];
}

/** A photo picked in the chat, already downscaled for upload. */
export interface PickedPhoto {
  id: string;
  name: string;
  /** JPEG data URL, ≤1600 px on the long side */
  dataUrl: string;
  width: number;
  height: number;
}

const MAX_SIDE = 1600;
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Reads a photo and shrinks it to ≤1600 px JPEG with a canvas. Plain DOM APIs only (Image, canvas, object URLs),
 * so it works over plain http on the network IP, where secure-context-only APIs are missing.
 */
export async function preparePhoto(file: File): Promise<PickedPhoto> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} isn't a photo`);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`Couldn't open ${file.name}. Try a JPEG or PNG photo.`));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't prepare photos");
    ctx.fillStyle = "#fff"; // transparent PNGs get a white background, not black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    let quality = 0.85;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length * 0.75 > MAX_BYTES && quality > 0.4) {
      quality -= 0.15;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length * 0.75 > MAX_BYTES) throw new Error(`${file.name} is too large even after shrinking`);
    return { id: uid(), name: file.name, dataUrl, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const photoSrc = (a: Attachment) => `/api${a.url}`;

interface ChatCtx {
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: ChatMessage[];
  /** Show the typing dots: a reply is on its way */
  typing: boolean;
  /** A message is being sent right now; the box waits for it */
  sending: boolean;
  /** Send an unsent message again */
  retry: (id: string) => void;
  /** A person from the team is on this chat (they took it over from Aria) */
  agent: string | null;
  /** Replies arrived while the widget was closed */
  unread: number;
  draft: string;
  setDraft: (d: string) => void;
  /** Send a message. With `answer`, it answers the open question card; with `photos`, they go with it. */
  send: (text: string, answer?: Omit<ChatAnswer, "original" | "kind">, photos?: PickedPhoto[]) => Promise<void>;
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

const greeting = (name: string | undefined, at: Date): ChatMessage => ({
  id: "hello",
  from: "bot",
  text: `Hi${name ? ` ${name.split(" ")[0]}` : ""}! I'm the ShopKart assistant. Ask me about an order, a refund or a payment.`,
  at,
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
      ...(m.attachments?.length && { photos: m.attachments.map((a, k) => ({ src: photoSrc(a), alt: `Photo ${k + 1} sent ${m.sender === "customer" ? "by you" : ""}`.trim() })) }),
      ...(m.ask && {
        ask: m.ask,
        // A photo card is answered by the photos sent after it; an order card by the pick (or closed by anything else).
        ...(next && { answered: m.ask.kind === "photos" ? (next.attachments?.length ? `${next.attachments.length} photo${next.attachments.length === 1 ? "" : "s"}` : "") : (next.answer?.text ?? "") }),
      }),
    };
  });
}

/** Messages only this tab has: one being sent, or one that couldn't be sent. `after` = the newest stored message id when it was made. */
interface Local {
  m: ChatMessage;
  after: number;
  /** Uploaded photos (attachment ids) that go with it */
  attachments?: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** How long a dropped message keeps being resent, and how long we wait for an answer to one that arrived. */
const RESEND_FOR_MS = 120_000;
const ANSWER_WAIT_MS = 90_000;

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
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [inlineMounted, setInlineMounted] = useState(false);
  const [locals, setLocals] = useState<Local[]>([]);
  const [opened] = useState(() => new Date());
  const session = useMemo(() => (customer ? sessionFor(customer.id) : null), [customer?.id]);
  const transcript = usePoll<ChatTranscript>(session ? `/chat/sessions/${encodeURIComponent(session)}` : null, 2000);
  const stored = transcript.data?.session_id === session ? transcript.data.messages : undefined;
  const lastId = stored?.at(-1)?.id ?? 0;

  useEffect(() => {
    setDraft("");
    setTyping(false);
    setSending(false);
    setAwaiting(null);
    setLocals([]);
  }, [customer?.id]);

  // Stored messages, with this tab's own in place. A message being sent shows until the stored copy arrives.
  const messages = useMemo(() => {
    const list = stored ?? [];
    const sent = (l: Local) => l.m.from === "me" && list.some((x) => x.id > l.after && x.sender === "customer" && x.body === l.m.text);
    const mine = locals.filter((l) => !sent(l));
    // The greeting is as old as the chat (or this visit, before the first message).
    const out: ChatMessage[] = [greeting(customer?.name, list[0] ? new Date(list[0].created_at) : opened), ...mine.filter((l) => l.after === 0).map((l) => l.m)];
    for (const m of bubbles(list)) {
      out.push(m);
      out.push(...mine.filter((l) => String(l.after) === m.id).map((l) => l.m));
    }
    const placed = new Set(out);
    out.push(...mine.map((l) => l.m).filter((m) => !placed.has(m)));
    return out;
  }, [stored, locals, customer?.name, opened]);

  // A message that reached us but whose answer didn't come back on the same request (the connection dropped, the
  // API restarted): the answer still lands in the stored chat, so keep the typing dots up until it shows there.
  const [awaiting, setAwaiting] = useState<number | null>(null);
  const answered = awaiting !== null && !!stored?.some((m) => m.id > awaiting && m.sender !== "customer");
  useEffect(() => {
    if (awaiting === null) return;
    if (answered) return setAwaiting(null);
    const t = setTimeout(() => {
      setAwaiting(null);
      // Still nothing: the message is in the team's inbox (Control Room → Chats), so say that rather than an error.
      setLocals((l) => [...l, { m: { id: uid(), from: "bot", text: "Thanks for waiting. Your message is with our support team and we'll reply right here.", at: new Date() }, after: awaiting }]);
    }, ANSWER_WAIT_MS);
    return () => clearTimeout(t);
  }, [awaiting, answered]);

  const path = session ? `/chat/sessions/${encodeURIComponent(session)}` : null;
  /** The stored copy of a message I sent after `after`, if it got through. */
  const storedCopy = useCallback(
    async (msg: string, after: number) => {
      if (!path) return null;
      const t = await api.get<ChatTranscript>(path).catch(() => null);
      return t?.messages.find((x) => x.id > after && x.sender === "customer" && x.body === msg) ?? null;
    },
    [path],
  );

  const deliver = useCallback(
    async (localId: string, msg: string, after: number, answer?: ChatAnswer, attachments: number[] = []) => {
      if (!customer || !session) return;
      const mark = (status: ChatMessage["status"]) => setLocals((l) => l.map((x) => (x.m.id === localId ? { ...x, m: { ...x.m, status } } : x)));
      const until = Date.now() + RESEND_FOR_MS;
      setSending(true);
      setTyping(true);
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            await api.post<ChatResponse>("/chat", { session_id: session, customer_id: customer.id, message: msg, ...(answer && { answer }), ...(attachments.length && { attachments }) });
            return;
          } catch (e) {
            // Refused for good (a bad request): resending won't help.
            if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500) return mark("unsent");
            // The request may well have arrived and be worked on; only resend if it never got through.
            await sleep(Math.min(800 * 2 ** attempt, 5000));
            const copy = await storedCopy(msg, after);
            if (copy) return setAwaiting(copy.id);
            if (Date.now() > until) return mark("unsent");
            mark("sending");
          }
        }
      } finally {
        await transcript.refresh();
        setSending(false);
        setTyping(false);
      }
    },
    [customer, session, storedCopy, transcript],
  );

  const send = useCallback(
    async (text: string, picked?: Omit<ChatAnswer, "original" | "kind">, photos: PickedPhoto[] = []) => {
      const msg = text.trim() || (photos.length ? `${photos.length === 1 ? "A photo" : `${photos.length} photos`} of the damage` : "");
      if (!msg || !customer || !session) return;
      // An open question card: a pick from it, or a typed order number / product name, answers it. Photos answer
      // an open "Add photos" card. Anything else typed is a new message, and the card closes unanswered.
      const card = [...messages].reverse().find((m) => m.ask && m.answered === undefined);
      let answer: ChatAnswer | undefined;
      if (card?.ask?.kind === "photos") {
        if (photos.length) answer = { kind: "photos", original: card.ask.original, value: card.ask.photos?.order_id ? String(card.ask.photos.order_id) : null, text: msg };
      } else if (card?.ask) {
        const typed = picked ?? typedAnswer(msg, card.ask);
        if (typed) answer = { kind: card.ask.kind, original: card.ask.original, ...typed };
      }
      // Photos go up first (the API keeps the bytes); the message then carries their ids. A failed upload throws,
      // so the chat can say what went wrong and keep the photos for another try.
      let attachments: number[] = [];
      if (photos.length) {
        const body: UploadAttachmentsBody = { session_id: session, customer_id: customer.id, files: photos.map((p) => ({ name: p.name, data_url: p.dataUrl, width: p.width, height: p.height })) };
        const res = await api.post<{ attachments: Attachment[] }>("/shop/chat/attachments", body);
        attachments = res.attachments.map((a) => a.id);
      }
      const after = lastId;
      const id = uid();
      const previews = photos.map((p, k) => ({ src: p.dataUrl, alt: `Photo ${k + 1} you're sending` }));
      setLocals((l) => [...l, { m: { id, from: "me", text: msg, at: new Date(), status: "sending", ...(previews.length && { photos: previews }) }, after, attachments }]);
      setDraft("");
      await deliver(id, msg, after, answer, attachments);
    },
    [customer, session, messages, lastId, deliver],
  );

  const retry = useCallback(
    (id: string) => {
      const l = locals.find((x) => x.m.id === id);
      if (!l || sending) return;
      setLocals((all) => all.map((x) => (x.m.id === id ? { ...x, m: { ...x.m, status: "sending" } } : x)));
      void deliver(id, l.m.text, l.after, undefined, l.attachments ?? []);
    },
    [locals, sending, deliver],
  );

  // Unread: replies (Aria finishing later, a person on the team) that came in while the widget was closed.
  const [seen, setSeen] = useState(0);
  const visible = open || inlineMounted;
  useEffect(() => {
    // What was already there when the page loaded counts as read; so does everything once the chat is on screen.
    if ((visible || !seen) && lastId > seen) setSeen(lastId);
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
    typing: typing || awaiting !== null,
    sending,
    retry,
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

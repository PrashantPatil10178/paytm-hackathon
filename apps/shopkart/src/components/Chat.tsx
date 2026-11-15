import { clock } from "@ph/shared";
import { CheckCheck, MessageCircle, SendHorizontal, Ticket, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useChat, useCustomer, type ChatMessage } from "../store.tsx";
import { ChatForm } from "./ChatForm.tsx";
import { LogoMark } from "./Logo.tsx";
import { BRAND, ResolveAIGlyph } from "@ph/shared/brand";

const QUICK = ["Where is my order?", "Item damaged, I want a refund", "₹15,000 debited but payment failed"];

/** The floating launcher + window. Hidden while the Help page shows the chat inline. */
export function ChatWidget() {
  const { open, setOpen, inlineMounted } = useChat();
  const launcher = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        launcher.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (inlineMounted) return null;

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="ShopKart Support chat"
          className="fixed inset-0 z-50 flex animate-sheet-in flex-col overflow-hidden bg-paper sm:inset-auto sm:right-6 sm:bottom-24 sm:h-[min(600px,calc(100dvh-8rem))] sm:w-[384px] sm:rounded-2xl sm:shadow-[var(--shadow-pop)]"
        >
          <ChatPanel onClose={() => setOpen(false)} autoFocus />
        </div>
      )}
      <button
        ref={launcher}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? "Close support chat" : "Chat with ShopKart Support"}
        className={`fixed right-4 bottom-4 z-40 grid size-14 cursor-pointer place-items-center rounded-full bg-jamun text-white shadow-[var(--shadow-lift)] transition-[transform,background-color] duration-200 hover:scale-105 hover:bg-jamun-ink active:scale-95 sm:right-6 sm:bottom-6 ${
          open ? "max-sm:hidden" : ""
        }`}
      >
        {open ? <X size={24} /> : <MessageCircle size={26} />}
      </button>
    </>
  );
}

export function ChatPanel({ onClose, autoFocus = false }: { onClose?: () => void; autoFocus?: boolean }) {
  const { messages, typing, draft, setDraft, send } = useChat();
  const { customer } = useCustomer();
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    // A new form is taller than the window: bring its top into view so the question is read first.
    const form = messages.at(-1)?.from === "form" ? [...el.querySelectorAll<HTMLElement>("[data-chat-form]")].at(-1) : undefined;
    const top = form ? el.scrollTop + form.getBoundingClientRect().top - el.getBoundingClientRect().top - 12 : el.scrollHeight;
    el.scrollTo({ top, behavior });
  }, [messages, typing]);

  // Focus the box when the widget opens or a "Need help?" button fills it in.
  useEffect(() => {
    if (!autoFocus && !draft) return;
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // only on open and when a draft is injected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, draft.startsWith("I need help with order")]);

  const submit = () => {
    if (!typing) send(draft);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-16 flex-none items-center gap-3 bg-jamun px-4 text-white">
        <span className="rounded-full bg-white p-0.5">
          <LogoMark size={34} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-display text-base font-bold tracking-tight">ShopKart Support</p>
          <p className="flex items-center gap-1 text-xs text-white/75">
            {typing ? "typing…" : <><ResolveAIGlyph size={14} className="text-white" dot={BRAND.mint} />Powered by ResolveAI</>}
          </p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close chat" className="grid size-9 cursor-pointer place-items-center rounded-full text-white/85 hover:bg-white/15 hover:text-white focus-visible:outline-white">
            <X size={20} />
          </button>
        )}
      </header>

      <div
        ref={scroller}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto bg-chat-wall px-3 py-4"
        aria-live="polite"
        aria-label="Messages"
        role="log"
      >
        <p className="mx-auto mb-2 rounded-lg bg-[#fff3c4] px-3 py-1.5 text-center text-[12px] text-[#54400a]">
          {customer ? `Chatting as ${customer.name}. ` : ""}Messages go to ShopKart's support team.
        </p>
        {messages.map((m, i) => (
          <Bubble key={m.id} m={m} tail={messages[i - 1]?.from !== m.from} />
        ))}
        {typing && (
          <div className="mt-1 flex w-fit animate-pop-in items-center gap-1 rounded-lg rounded-tl-none bg-chat-in px-3.5 py-3 shadow-[0_1px_0.5px_rgb(11_20_26/0.13)]" aria-label="Support is typing">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-2 animate-typing rounded-full bg-ink-3" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        )}
      </div>

      <div className="flex-none border-t border-line bg-paper">
        <div className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1" role="group" aria-label="Quick questions">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              disabled={typing}
              onClick={() => send(q)}
              className="flex-none cursor-pointer rounded-full border border-jamun/25 bg-jamun-wash px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap text-jamun transition-colors hover:border-jamun hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="chat-input" className="sr-only">Type a message</label>
          <textarea
            id="chat-input"
            ref={input}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Type a message"
            className="max-h-28 min-h-11 flex-1 resize-none rounded-3xl border border-line bg-wash px-4 py-2.5 leading-snug placeholder:text-ink-3 focus:border-jamun focus:bg-paper focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || typing}
            aria-label="Send message"
            className="grid size-11 flex-none cursor-pointer place-items-center rounded-full bg-jamun text-white transition-[background-color,transform] hover:bg-jamun-ink active:scale-95 disabled:cursor-not-allowed disabled:bg-ink-3/40"
          >
            <SendHorizontal size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}

function Bubble({ m, tail }: { m: ChatMessage; tail: boolean }) {
  if (m.from === "form" && m.requestId) return <ChatForm requestId={m.requestId} />;
  if (m.from === "system")
    return (
      <p className="mx-auto my-1.5 flex animate-pop-in items-center gap-1.5 rounded-lg bg-[#e1f2fb] px-3 py-1 text-[12px] font-semibold text-[#1b4f6b] shadow-[0_1px_0.5px_rgb(11_20_26/0.13)]">
        <Ticket size={13} aria-hidden /> {m.text}
      </p>
    );
  const mine = m.from === "me";
  return (
    <div
      className={`flex max-w-[85%] animate-pop-in flex-col rounded-lg px-2.5 pt-1.5 pb-1 shadow-[0_1px_0.5px_rgb(11_20_26/0.13)] ${
        mine ? "self-end bg-chat-out" : m.failed ? "self-start bg-bad-wash" : "self-start bg-chat-in"
      } ${tail ? (mine ? "mt-1.5 rounded-tr-none" : "mt-1.5 rounded-tl-none") : ""}`}
    >
      {m.from === "team" && m.author && <p className="mb-0.5 text-[12.5px] font-semibold text-jamun">{m.author.split(" – ")[0]} · ShopKart team</p>}
      {m.image && <img src={m.image} alt="Photo you sent" className="mb-1 max-h-40 rounded-md object-cover" />}
      <p className="text-[14.5px] leading-snug whitespace-pre-wrap text-[#111b21] [overflow-wrap:anywhere]">{m.text}</p>
      <span className="mt-0.5 flex items-center justify-end gap-1 self-end text-[11px] text-[#667781]">
        {clock(m.at.toISOString())}
        {mine && <CheckCheck size={15} className="text-chat-tick" aria-label="Delivered" />}
      </span>
    </div>
  );
}

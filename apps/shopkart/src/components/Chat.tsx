import { clock } from "@ph/shared";
import { Camera, Check, CheckCheck, Clock3, ImagePlus, Loader2, MessageCircle, SendHorizontal, Ticket, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { preparePhoto, useChat, useCustomer, type ChatMessage, type PickedPhoto } from "../store.tsx";
import { LogoMark } from "./Logo.tsx";
import { BRAND, ResolveAIGlyph } from "@ph/shared/brand";

const QUICK = ["Where is my order?", "Item damaged, I want a refund", "₹15,000 debited but payment failed"];
const MAX_PHOTOS = 3;

/**
 * Photos picked for the next message: a hidden file input (camera or gallery, images only), shrunk in the browser
 * before upload. Shared by the composer and Aria's "Add photos" card.
 */
function usePhotoPicker() {
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const add = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setError("");
      const room = MAX_PHOTOS - photos.length;
      const list = [...files];
      if (list.length > room) setError(`You can send up to ${MAX_PHOTOS} photos at a time.`);
      setBusy(true);
      try {
        const ready: PickedPhoto[] = [];
        for (const f of list.slice(0, Math.max(0, room))) {
          try {
            ready.push(await preparePhoto(f));
          } catch (e) {
            setError((e as Error).message);
          }
        }
        setPhotos((p) => [...p, ...ready].slice(0, MAX_PHOTOS));
      } finally {
        setBusy(false);
        if (input.current) input.current.value = "";
      }
    },
    [photos.length],
  );
  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/*"
      multiple
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => void add(e.target.files)}
    />
  );
  return {
    photos,
    error,
    setError,
    busy,
    picker,
    open: () => input.current?.click(),
    remove: (id: string) => setPhotos((p) => p.filter((x) => x.id !== id)),
    clear: () => setPhotos([]),
  };
}

/** Thumbnails of picked photos, each removable. */
function PhotoTray({ photos, onRemove, size = "size-16" }: { photos: PickedPhoto[]; onRemove: (id: string) => void; size?: string }) {
  if (!photos.length) return null;
  return (
    <ul className="flex gap-2" aria-label="Photos to send">
      {photos.map((p, i) => (
        <li key={p.id} className={`relative ${size} flex-none animate-pop-in overflow-hidden rounded-xl border border-line bg-wash`}>
          <img src={p.dataUrl} alt={`Photo ${i + 1}: ${p.name}`} className="size-full object-cover" />
          <button
            type="button"
            onClick={() => onRemove(p.id)}
            aria-label={`Remove photo ${i + 1}`}
            className="absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full bg-ink/70 text-white hover:bg-ink"
          >
            <X size={12} strokeWidth={3} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The floating launcher + window. Hidden while the Help page shows the chat inline. */
export function ChatWidget() {
  const { open, setOpen, inlineMounted, unread } = useChat();
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
          className="fixed inset-0 z-50 flex animate-sheet-in flex-col overflow-clip bg-paper sm:inset-auto sm:right-6 sm:bottom-24 sm:h-[min(600px,calc(100dvh-8rem))] sm:w-[384px] sm:rounded-2xl sm:shadow-[var(--shadow-pop)]"
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
        {!open && unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-5 animate-pop-in place-items-center rounded-full border-2 border-paper bg-bad px-1 text-[11px] leading-4 font-bold text-white" aria-label={`${unread} new ${unread === 1 ? "reply" : "replies"}`}>
            {unread}
          </span>
        )}
      </button>
    </>
  );
}

export function ChatPanel({ onClose, autoFocus = false }: { onClose?: () => void; autoFocus?: boolean }) {
  const { messages, typing, sending, agent, draft, setDraft, send } = useChat();
  const { customer } = useCustomer();
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pick = usePhotoPicker();

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [messages.length, typing]);

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

  const [uploading, setUploading] = useState(false);
  const submit = () => {
    if (sending || uploading || pick.busy || (!draft.trim() && !pick.photos.length)) return;
    const photos = pick.photos;
    setUploading(photos.length > 0);
    pick.setError("");
    send(draft, undefined, photos)
      .then(() => pick.clear())
      // The upload failed: the photos stay in the tray, so a tap on send tries again.
      .catch((e: Error) => pick.setError(`Couldn't send the photo${photos.length === 1 ? "" : "s"}: ${e.message}`))
      .finally(() => setUploading(false));
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
            {typing ? (
              "typing…"
            ) : agent ? (
              <><span className="size-2 rounded-full bg-[#4ade80]" aria-hidden />{agent} from ShopKart is here</>
            ) : (
              <><ResolveAIGlyph size={14} className="text-white" dot={BRAND.mint} />Powered by ResolveAI</>
            )}
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
              disabled={sending}
              onClick={() => send(q)}
              className="flex-none cursor-pointer rounded-full border border-jamun/25 bg-jamun-wash px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap text-jamun transition-colors hover:border-jamun hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
        {(pick.photos.length > 0 || pick.error || pick.busy || uploading) && (
          <div className="flex flex-col gap-1.5 px-3 pt-2">
            <PhotoTray photos={pick.photos} onRemove={pick.remove} />
            {(pick.busy || uploading) && <p className="flex items-center gap-1.5 text-[12px] text-ink-2"><Loader2 size={13} className="animate-spin" aria-hidden />{uploading ? "Sending photos…" : "Preparing photo…"}</p>}
            {pick.error && <p role="alert" className="text-[12px] font-semibold text-bad">{pick.error}</p>}
          </div>
        )}
        <form
          className="flex items-end gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {pick.picker}
          <button
            type="button"
            onClick={pick.open}
            disabled={sending || pick.photos.length >= MAX_PHOTOS}
            aria-label="Add photos"
            title="Add photos (camera or gallery)"
            className="grid size-11 flex-none cursor-pointer place-items-center rounded-full text-jamun transition-colors hover:bg-jamun-wash disabled:cursor-not-allowed disabled:text-ink-3/50"
          >
            <Camera size={22} />
          </button>
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
            placeholder={pick.photos.length ? "Add a caption (optional)" : "Type a message"}
            className="max-h-28 min-h-11 flex-1 resize-none rounded-3xl border border-line bg-wash px-4 py-2.5 leading-snug placeholder:text-ink-3 focus:border-jamun focus:bg-paper focus:outline-none"
          />
          <button
            type="submit"
            disabled={(!draft.trim() && !pick.photos.length) || sending || pick.busy || uploading}
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
  const { retry } = useChat();
  if (m.from === "system")
    return (
      <p className="mx-auto my-1.5 flex animate-pop-in items-center gap-1.5 rounded-lg bg-[#e1f2fb] px-3 py-1 text-[12px] font-semibold text-[#1b4f6b] shadow-[0_1px_0.5px_rgb(11_20_26/0.13)]">
        {m.text.startsWith("Ticket") ? <Ticket size={13} aria-hidden /> : <UserRound size={13} aria-hidden />} {m.text}
      </p>
    );
  const mine = m.from === "me";
  return (
    <div
      className={`flex max-w-[85%] animate-pop-in flex-col rounded-lg px-2.5 pt-1.5 pb-1 shadow-[0_1px_0.5px_rgb(11_20_26/0.13)] ${
        mine ? "self-end bg-chat-out" : "self-start bg-chat-in"
      } ${tail ? (mine ? "mt-1.5 rounded-tr-none" : "mt-1.5 rounded-tl-none") : ""}`}
    >
      {m.from === "agent" && tail && (
        <p className="mb-0.5 text-[12.5px] font-bold text-jamun">
          {m.author} <span className="font-semibold text-ink-3">· ShopKart team</span>
        </p>
      )}
      {m.photos && m.photos.length > 0 && (
        <div className={`mb-1 grid gap-1 ${m.photos.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {m.photos.map((p) => (
            <a key={p.src} href={p.src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md bg-wash">
              <img src={p.src} alt={p.alt} className="max-h-56 w-full min-w-28 object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      <p className="text-[14.5px] leading-snug whitespace-pre-wrap text-[#111b21] [overflow-wrap:anywhere]">{m.text}</p>
      {m.ask?.kind === "photos" ? <PhotoCard m={m} /> : m.ask && <QuestionCard m={m} />}
      <span className="mt-0.5 flex items-center justify-end gap-1 self-end text-[11px] text-[#667781]">
        {mine && m.status === "unsent" ? (
          <button type="button" onClick={() => retry(m.id)} className="cursor-pointer font-semibold text-jamun underline-offset-2 hover:underline">
            Not sent · Tap to retry
          </button>
        ) : (
          clock(m.at.toISOString())
        )}
        {mine && !m.status && <CheckCheck size={15} className="text-chat-tick" aria-label="Delivered" />}
        {mine && m.status === "sending" && <Clock3 size={13} aria-label="Sending" />}
      </span>
    </div>
  );
}

const OTHER = "other";

/**
 * Aria's question, inside its bubble: pick one choice (a product or order) or type another answer, then Send.
 * A fieldset of native radios, so arrow keys move between choices and Enter in the text box sends.
 * Once answered (or the customer typed something else instead) it locks and shows what was picked.
 */
function QuestionCard({ m }: { m: ChatMessage }) {
  const { send, sending } = useChat();
  const ask = m.ask!;
  const name = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const done = m.answered !== undefined;
  const choice = picked && picked !== OTHER ? ask.choices[Number(picked)] : undefined;
  const ready = !done && !sending && (choice || (picked === OTHER && other.trim()));

  const submit = () => {
    if (!ready) return;
    if (choice) void send(`${choice.label} (order #${choice.value})`, { value: choice.value, text: `${choice.label} (order #${choice.value})` });
    else void send(other.trim(), { value: null, text: other.trim() });
  };

  return (
    <form
      className="mt-2 mb-1 min-w-[16rem]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset disabled={done} className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-0.5 p-0 text-[13.5px] font-bold text-ink">{ask.prompt}</legend>
        {ask.description && <p className="mb-2 text-[12.5px] text-ink-2">{ask.description}</p>}
        <div className="flex flex-col gap-1.5">
          {ask.choices.map((c, i) => {
            const on = picked === String(i) || (done && m.answered === `${c.label} (order #${c.value})`);
            return (
              <label
                key={`${c.value}-${i}`}
                className={`relative flex cursor-pointer items-center gap-2.5 rounded-xl border p-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-jamun ${
                  on ? "border-jamun bg-jamun-wash" : "border-line bg-paper hover:border-jamun/40"
                } ${done && !on ? "opacity-50" : ""} ${done ? "cursor-default" : ""}`}
              >
                <input type="radio" name={name} value={i} checked={on} onChange={() => setPicked(String(i))} className="sr-only" />
                {c.image ? <img src={c.image} alt="" className="size-10 flex-none rounded-lg bg-wash object-cover" /> : null}
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{c.label}</span>
                  {c.description && <span className="block truncate text-[12px] text-ink-2">{c.description}</span>}
                </span>
                <span className={`grid size-5 flex-none place-items-center rounded-full border-2 ${on ? "border-jamun bg-jamun text-white" : "border-line"}`} aria-hidden>
                  {on && <Check size={12} strokeWidth={3} />}
                </span>
              </label>
            );
          })}
          {ask.other && (
            <label
              className={`relative flex cursor-pointer flex-col gap-2 rounded-xl border p-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-jamun ${
                picked === OTHER ? "border-jamun bg-jamun-wash" : "border-line bg-paper hover:border-jamun/40"
              } ${done ? "cursor-default opacity-50" : ""}`}
            >
              <span className="flex items-center gap-2.5">
                <input type="radio" name={name} value={OTHER} checked={picked === OTHER} onChange={() => setPicked(OTHER)} className="sr-only" />
                <span className="flex-1 text-[13.5px] font-semibold text-ink">{ask.other.label}</span>
                <span className={`grid size-5 flex-none place-items-center rounded-full border-2 ${picked === OTHER ? "border-jamun bg-jamun text-white" : "border-line"}`} aria-hidden>
                  {picked === OTHER && <Check size={12} strokeWidth={3} />}
                </span>
              </span>
              {picked === OTHER && (
                <input
                  autoFocus
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  aria-label={ask.other.label}
                  placeholder={ask.other.placeholder}
                  inputMode="numeric"
                  className="h-9 rounded-lg border border-line bg-paper px-3 text-[13.5px] text-ink placeholder:text-ink-3 focus:border-jamun focus:outline-none"
                />
              )}
            </label>
          )}
        </div>
        {done ? (
          <p className="mt-2 text-[12px] text-ink-2">{m.answered ? `You picked: ${m.answered}` : "Closed: you asked something else."}</p>
        ) : (
          <button
            type="submit"
            disabled={!ready}
            className="mt-2.5 flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full bg-jamun text-[13.5px] font-semibold text-white transition-colors hover:bg-jamun-ink disabled:cursor-not-allowed disabled:bg-ink-3/40"
          >
            Send <SendHorizontal size={15} aria-hidden />
          </button>
        )}
      </fieldset>
    </form>
  );
}

/**
 * Aria asked for photos of the damage: pick 1–3 (camera or gallery), see them, send. Once photos were sent after
 * it (or the customer wrote something else) it locks and says what happened.
 */
function PhotoCard({ m }: { m: ChatMessage }) {
  const { send, sending } = useChat();
  const ask = m.ask!;
  const pick = usePhotoPicker();
  const [uploading, setUploading] = useState(false);
  const done = m.answered !== undefined;
  const ready = !done && !sending && !uploading && !pick.busy && pick.photos.length > 0;

  const submit = () => {
    if (!ready) return;
    setUploading(true);
    pick.setError("");
    send("", undefined, pick.photos)
      .then(() => pick.clear())
      .catch((e: Error) => pick.setError(`Couldn't send the photos: ${e.message}`))
      .finally(() => setUploading(false));
  };

  return (
    <div className="mt-2 mb-1 min-w-[16rem] rounded-xl border border-line bg-paper p-2.5">
      <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink">
        <ImagePlus size={16} className="text-jamun" aria-hidden />
        {ask.prompt}
      </p>
      {ask.description && <p className="mt-0.5 text-[12.5px] text-ink-2">{ask.description}</p>}
      {done ? (
        <p className="mt-2 text-[12px] text-ink-2">{m.answered ? `You sent ${m.answered}.` : "Closed: you wrote something else. Use the camera button below to add photos any time."}</p>
      ) : (
        <>
          {pick.picker}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PhotoTray photos={pick.photos} onRemove={pick.remove} size="size-14" />
            {pick.photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={pick.open}
                disabled={sending || pick.busy}
                className="flex size-14 flex-none cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-jamun/50 bg-jamun-wash text-[11px] font-semibold text-jamun hover:border-jamun disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pick.busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Camera size={18} aria-hidden />}
                {pick.photos.length ? "More" : "Add"}
              </button>
            )}
          </div>
          {pick.error && <p role="alert" className="mt-1.5 text-[12px] font-semibold text-bad">{pick.error}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={!ready}
            className="mt-2.5 flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full bg-jamun text-[13.5px] font-semibold text-white transition-colors hover:bg-jamun-ink disabled:cursor-not-allowed disabled:bg-ink-3/40"
          >
            {uploading ? "Sending…" : pick.photos.length ? `Send ${pick.photos.length} photo${pick.photos.length === 1 ? "" : "s"}` : "Pick photos first"} <SendHorizontal size={15} aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}

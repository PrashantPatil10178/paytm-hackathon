import { BOT, type InfoRequest, type InfoRequestField } from "@ph/shared";
import { ResolveAIGlyph } from "@ph/shared/brand";
import { Camera, Check, CircleCheck, LoaderCircle, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useChat } from "../store.tsx";

/** Phone photos are several MB: shrink to 720px JPEG in the browser before sending. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.72);
}

const asker = (r: InfoRequest) => (r.requested_by === BOT ? "ShopKart assistant" : `${r.requested_by.split(" – ")[0]} from ShopKart`);

/** A request form inside the chat: tap the order, pick what went wrong, add a photo, send. */
export function ChatForm({ requestId }: { requestId: number }) {
  const { requests, answer, typing, sending: busy } = useChat();
  const r = requests[requestId];
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!r) return null;
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const missing = r.fields.filter((f) => f.required && !values[f.key]?.trim());

  const submit = async () => {
    if (missing.length) return setError(`Please answer: ${missing.map((f) => f.label.replace(/\?$/, "")).join(", ")}`);
    setSending(true);
    setError(null);
    const err = await answer(r.id, values);
    setSending(false);
    if (err) setError(err);
  };

  return (
    <section
      data-chat-form={r.id}
      aria-label={r.title}
      className="mt-1.5 w-[92%] max-w-[340px] flex-none animate-pop-in self-start overflow-hidden rounded-xl rounded-tl-none border border-jamun/15 bg-chat-in shadow-[0_1px_0.5px_rgb(11_20_26/0.13)]"
    >
      <header className="border-b border-line bg-jamun-wash px-3.5 py-2.5">
        <p className="flex items-center gap-1 text-[11px] font-semibold text-jamun">
          {r.requested_by === BOT && <ResolveAIGlyph size={12} />}
          {asker(r)}
        </p>
        <h3 className="font-display text-[15px] leading-tight font-bold text-ink">{r.title}</h3>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{r.ask}</p>
      </header>

      {r.status === "answered" ? (
        <div className="px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ok"><CircleCheck size={16} aria-hidden />Details sent</p>
          <dl className="mt-1.5 space-y-1 text-[13px]">
            {r.answers?.map((a) => (
              <div key={a.key} className="flex gap-2">
                <dt className="shrink-0 text-ink-3">{a.label.replace(/\?$/, "")}</dt>
                <dd className="min-w-0 truncate font-medium text-ink">{a.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : r.status === "withdrawn" ? (
        <p className="px-3.5 py-3 text-[13px] text-ink-3">This form was replaced or taken back. No need to fill it in.</p>
      ) : (
        <form
          className="space-y-3.5 px-3.5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {r.fields.map((f) => (
            <Field key={f.key} field={f} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
          ))}
          {error && <p role="alert" className="rounded-md bg-bad-wash px-2.5 py-1.5 text-[12.5px] text-bad">{error}</p>}
          <button
            type="submit"
            disabled={sending || busy || typing}
            className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-jamun text-[14px] font-semibold text-white transition-colors hover:bg-jamun-ink disabled:cursor-not-allowed disabled:bg-ink-3/40"
          >
            {sending ? <><LoaderCircle size={16} className="animate-spin" aria-hidden />Sending…</> : "Send details"}
          </button>
        </form>
      )}
    </section>
  );
}

function Legend({ field }: { field: InfoRequestField }) {
  return (
    <legend className="mb-1.5 text-[13px] font-semibold text-ink">
      {field.label}
      {!field.required && <span className="font-normal text-ink-3"> (optional)</span>}
    </legend>
  );
}

function Field({ field, value, onChange }: { field: InfoRequestField; value: string; onChange: (v: string) => void }) {
  const name = useId();
  const file = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  if (field.kind === "order")
    return (
      <fieldset>
        <Legend field={field} />
        <div className="space-y-1.5">
          {field.choices?.map((c) => {
            const on = value === c.value;
            return (
              <label
                key={c.value}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-jamun ${
                  on ? "border-jamun bg-jamun-wash" : "border-line hover:border-jamun/40"
                }`}
              >
                <input type="radio" name={name} value={c.value} checked={on} onChange={() => onChange(c.value)} className="sr-only" />
                {c.image ? <img src={c.image} alt="" className="size-10 flex-none rounded-md bg-wash object-cover" /> : <span className="size-10 flex-none rounded-md bg-wash" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{c.label}</span>
                  {c.detail && <span className="block text-[12px] text-ink-3 tabular-nums">{c.detail}</span>}
                </span>
                <span className={`grid size-5 flex-none place-items-center rounded-full border ${on ? "border-jamun bg-jamun text-white" : "border-line"}`} aria-hidden>
                  {on && <Check size={13} strokeWidth={3} />}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );

  if (field.kind === "choice")
    return (
      <fieldset>
        <Legend field={field} />
        <div className="flex flex-wrap gap-1.5">
          {field.choices?.map((c) => {
            const on = value === c.value;
            return (
              <label
                key={c.value}
                className={`cursor-pointer rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-jamun ${
                  on ? "border-jamun bg-jamun text-white" : "border-line text-ink-2 hover:border-jamun/40 hover:text-jamun"
                }`}
              >
                <input type="radio" name={name} value={c.value} checked={on} onChange={() => onChange(c.value)} className="sr-only" />
                {c.label}
              </label>
            );
          })}
        </div>
      </fieldset>
    );

  if (field.kind === "text")
    return (
      <fieldset>
        <Legend field={field} />
        <input
          aria-label={field.label}
          value={value}
          maxLength={500}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-lg border border-line bg-wash px-3 text-[14px] placeholder:text-ink-3 focus:border-jamun focus:bg-paper focus:outline-none"
        />
      </fieldset>
    );

  return (
    <fieldset>
      <Legend field={field} />
      <input
        ref={file}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label={field.label}
        className="sr-only"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setReading(true);
          try {
            onChange(await shrink(f));
          } finally {
            setReading(false);
          }
        }}
      />
      {value ? (
        <div className="relative w-fit">
          <img src={value} alt="Your photo" className="h-24 rounded-lg border border-line object-cover" />
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Remove photo"
            className="absolute -top-2 -right-2 grid size-6 cursor-pointer place-items-center rounded-full bg-ink text-white shadow"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => file.current?.click()}
          className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-jamun/40 px-3 text-[13px] font-semibold text-jamun hover:bg-jamun-wash"
        >
          {reading ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Camera size={16} aria-hidden />}
          {reading ? "Adding photo…" : "Add a photo"}
        </button>
      )}
    </fieldset>
  );
}

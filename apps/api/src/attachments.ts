/**
 * Photos customers attach in the ShopKart chat: proof before money on damage claims.
 *
 *   POST /shop/chat/attachments            the chat widget uploads 1–3 images (already downscaled in the browser)
 *   POST /chat { …, attachments: [ids] }   sends them with a message (agent.ts links them to that chat line)
 *   addComment({ attachment_ids })          puts them on the ticket comment that carries the message (zendesk.ts)
 *   GET  /attachments/:id                   the image (also /zendesk/attachments/:id, through the Zendesk connector)
 *   GET  /zendesk/tickets/:id/attachments   a ticket's photos, each with earlier uses of the same image (sha256)
 *
 * Stored as bytea in Postgres (see schema.ts): one store with the rows that point at them, wiped by a demo reset,
 * readable by every app through the API. Images are immutable, so they are served with a long cache.
 */
import type { Attachment, AttachmentWithReuse, UploadAttachmentsBody } from "@ph/shared";
import { and, desc, eq, inArray, isNull, ne, or, schema as s, toAttachment, type Tx } from "@ph/db";
import { db } from "./db.ts";
import { bad, body, CORS, handle, intParam, notFound, ok } from "./http.ts";

const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Every column but the bytes. */
export const META = {
  id: s.attachments.id,
  customer_id: s.attachments.customer_id,
  session_id: s.attachments.session_id,
  chat_message_id: s.attachments.chat_message_id,
  ticket_id: s.attachments.ticket_id,
  comment_id: s.attachments.comment_id,
  order_id: s.attachments.order_id,
  mime: s.attachments.mime,
  size: s.attachments.size,
  width: s.attachments.width,
  height: s.attachments.height,
  sha256: s.attachments.sha256,
  name: s.attachments.name,
  created_at: s.attachments.created_at,
};
export type AttachmentRow = Awaited<ReturnType<typeof metaWhere>>[number];
const metaWhere = (where: ReturnType<typeof and>, tx: Tx = db) => tx.select(META).from(s.attachments).where(where).orderBy(s.attachments.id);

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** "data:image/jpeg;base64,…" → bytes, checked against the allowed types and size. */
function decode(dataUrl: unknown, i: number): { mime: (typeof MIMES)[number]; bytes: Buffer } {
  const m = typeof dataUrl === "string" ? dataUrl.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/) : null;
  if (!m) throw bad(`files[${i}].data_url must be a base64 image data URL`);
  const mime = m[1] as (typeof MIMES)[number];
  if (!MIMES.includes(mime)) throw bad(`files[${i}] must be a JPEG, PNG or WebP photo`);
  const bytes = Buffer.from(m[2]!, "base64");
  if (!bytes.length) throw bad(`files[${i}] is empty`);
  if (bytes.length > MAX_BYTES) throw bad(`files[${i}] is over 5 MB`);
  // The bytes must really be that kind of image, not just labelled so.
  const magic =
    (mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (mime === "image/png" && bytes.subarray(0, 4).toString("hex") === "89504e47") ||
    (mime === "image/webp" && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP");
  if (!magic) throw bad(`files[${i}] isn't a valid ${mime.split("/")[1]!.toUpperCase()} image`);
  return { mime, bytes };
}

async function upload(b: UploadAttachmentsBody): Promise<Attachment[]> {
  if (typeof b.session_id !== "string" || !b.session_id.trim()) throw bad("session_id is required");
  const customerId = Number(b.customer_id);
  if (!Number.isInteger(customerId)) throw bad("customer_id is required");
  if (!Array.isArray(b.files) || !b.files.length) throw bad("Send 1 to 3 photos in files");
  if (b.files.length > MAX_FILES) throw bad("Send at most 3 photos at once");
  const [customer] = await db.select({ id: s.customers.id }).from(s.customers).where(eq(s.customers.id, customerId));
  if (!customer) throw notFound(`Customer ${customerId}`);
  const rows = b.files.map((f, i) => {
    const { mime, bytes } = decode(f?.data_url, i);
    const dim = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) <= 10_000 ? (v as number) : 0);
    return {
      customer_id: customerId,
      session_id: b.session_id.trim(),
      mime,
      size: bytes.length,
      width: dim(f.width),
      height: dim(f.height),
      sha256: sha256(bytes),
      name: String(f.name ?? "").slice(0, 120),
      data: bytes,
    };
  });
  const saved = await db.insert(s.attachments).values(rows).returning(META);
  return saved.map(toAttachment);
}

/**
 * Ties freshly uploaded photos to the chat line they were sent with. Only this customer's photos from this chat
 * that aren't on a line yet: ids from anyone else are ignored. Returns the ids that were taken.
 */
export async function linkToChatMessage(ids: unknown, chat: { session_id: string; customer_id: number }, messageId: number): Promise<number[]> {
  const wanted = cleanIds(ids);
  if (!wanted.length) return [];
  const rows = await db
    .update(s.attachments)
    .set({ chat_message_id: messageId })
    .where(and(inArray(s.attachments.id, wanted), eq(s.attachments.customer_id, chat.customer_id), eq(s.attachments.session_id, chat.session_id), isNull(s.attachments.chat_message_id)))
    .returning({ id: s.attachments.id });
  return rows.map((r) => r.id);
}

/**
 * Puts photos on a ticket comment. Only the ticket requester's own photos, and only ones not on another
 * ticket yet. The order is the ticket's, when it has one (order_id or "order #1023" in the subject).
 */
export async function linkToComment(tx: Tx, ids: unknown, ticket: { id: number; requester_id: number; order_id: number | null; subject: string }, commentId: number): Promise<number> {
  const wanted = cleanIds(ids);
  if (!wanted.length) return 0;
  const orderId = ticket.order_id ?? (Number(ticket.subject.match(/order #(\d+)/i)?.[1]) || null);
  const rows = await tx
    .update(s.attachments)
    .set({ ticket_id: ticket.id, comment_id: commentId, ...(orderId && { order_id: orderId }) })
    .where(and(inArray(s.attachments.id, wanted), eq(s.attachments.customer_id, ticket.requester_id), or(isNull(s.attachments.ticket_id), eq(s.attachments.ticket_id, ticket.id))))
    .returning({ id: s.attachments.id });
  return rows.length;
}

const cleanIds = (ids: unknown): number[] => (Array.isArray(ids) ? [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 10) : []);

/** Photos per comment, for a set of tickets (one query). */
export async function attachmentsByComment(ticketIds: number[], tx: Tx = db): Promise<Map<number, Attachment[]>> {
  if (!ticketIds.length) return new Map();
  const rows = await tx.select(META).from(s.attachments).where(inArray(s.attachments.ticket_id, ticketIds)).orderBy(s.attachments.id);
  return groupBy(rows.filter((r) => r.comment_id !== null), (r) => r.comment_id!);
}

/** Photos per chat line, for a set of chats (one query). */
export async function attachmentsByChatMessage(sessionIds: string[]): Promise<Map<number, Attachment[]>> {
  if (!sessionIds.length) return new Map();
  const rows = await db.select(META).from(s.attachments).where(inArray(s.attachments.session_id, sessionIds)).orderBy(s.attachments.id);
  return groupBy(rows.filter((r) => r.chat_message_id !== null), (r) => r.chat_message_id!);
}

/** Every photo on these tickets, per ticket (one query). */
export async function attachmentsByTicket(ticketIds: number[]): Promise<Map<number, Attachment[]>> {
  if (!ticketIds.length) return new Map();
  const rows = await db.select(META).from(s.attachments).where(inArray(s.attachments.ticket_id, ticketIds)).orderBy(s.attachments.id);
  return groupBy(rows, (r) => r.ticket_id!);
}

function groupBy(rows: AttachmentRow[], key: (r: AttachmentRow) => number): Map<number, Attachment[]> {
  const out = new Map<number, Attachment[]>();
  for (const r of rows) out.set(key(r), [...(out.get(key(r)) ?? []), toAttachment(r)]);
  return out;
}

/** A ticket's photos, each with the other places the same image (same sha256) was sent before: another ticket or order. */
async function ticketAttachments(ticketId: number): Promise<AttachmentWithReuse[]> {
  const mine = await metaWhere(eq(s.attachments.ticket_id, ticketId));
  if (!mine.length) return [];
  const same = await db
    .select(META)
    .from(s.attachments)
    .where(and(inArray(s.attachments.sha256, [...new Set(mine.map((a) => a.sha256))]), or(isNull(s.attachments.ticket_id), ne(s.attachments.ticket_id, ticketId))))
    .orderBy(desc(s.attachments.created_at));
  return mine.map((a) => ({
    ...toAttachment(a),
    reused: same
      .filter((x) => x.sha256 === a.sha256 && x.id !== a.id && x.created_at <= a.created_at)
      .map((x) => ({ id: x.id, ticket_id: x.ticket_id, customer_id: x.customer_id, order_id: x.order_id, created_at: x.created_at.toISOString() })),
  }));
}

async function image(id: number): Promise<Response> {
  const [row] = await db.select({ mime: s.attachments.mime, data: s.attachments.data }).from(s.attachments).where(eq(s.attachments.id, id));
  if (!row) return ok({ error: `Attachment ${id} not found` }, 404);
  return new Response(new Uint8Array(row.data), {
    headers: { ...CORS, "content-type": row.mime, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
  });
}

export const attachmentRoutes = {
  "/shop/chat/attachments": {
    POST: handle(async (req) => ok({ attachments: await upload(await body<UploadAttachmentsBody>(req)) }, 201)),
  },
  "/attachments/:id": { GET: handle((req) => image(intParam(req.params.id, "Attachment id"))) },
  "/zendesk/attachments/:id": { GET: handle((req) => image(intParam(req.params.id, "Attachment id"))) },
  "/zendesk/tickets/:id/attachments": {
    GET: handle(async (req) => ok({ attachments: await ticketAttachments(intParam(req.params.id, "Ticket id")) })),
  },
};

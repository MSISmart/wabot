import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { processInbound } from "@/engine/engine";
import type { Inbound } from "@/engine/types";
import { logEvent } from "@/lib/log";

export const maxDuration = 60;

type KapsoMessage = {
  id?: string; type?: string; from?: string; text?: { body?: string };
  interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  button?: { text?: string; payload?: string };
  kapso?: { content?: string; statuses?: { status: string; errors?: { code: number; title?: string; message?: string }[] }[] };
};
type KapsoEvent = {
  message?: KapsoMessage;
  conversation?: { contact_name?: string; phone_number?: string; phone_number_id?: string };
  phone_number_id?: string;
};

function validSignature(raw: string, header: string | null) {
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // never accept unsigned webhooks in production
  if (!header) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header.replace(/^sha256=/, ""));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

function toInbound(m: KapsoMessage): Inbound {
  const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
  if (reply) return { kind: "reply", text: reply.title ?? reply.id, replyId: reply.id, waMessageId: m.id };
  if (m.type === "text") return { kind: "text", text: m.text?.body ?? "", waMessageId: m.id };
  if (m.type === "button") return { kind: "text", text: m.button?.text ?? "", waMessageId: m.id };
  return { kind: "other", text: m.kapso?.content || `[${m.type ?? "הודעה"}]`, waMessageId: m.id };
}

async function handle(event: string, e: KapsoEvent) {
  const db = await getDb();
  const m = e.message;
  if (!m) return;
  if (event === "whatsapp.message.received") {
    const phoneNumberId = e.phone_number_id ?? e.conversation?.phone_number_id;
    const from = m.from ?? e.conversation?.phone_number;
    if (!phoneNumberId || !from) return;
    const [business] = await db.select({ id: schema.businesses.id }).from(schema.businesses)
      .where(eq(schema.businesses.phoneNumberId, phoneNumberId)).limit(1);
    if (!business) {
      await logEvent(null, "warn", "unknown_number", `התקבלה הודעה למספר שלא משויך לאף עסק (${phoneNumberId})`);
      return;
    }
    await processInbound(business.id, from.replace(/\D/g, ""), e.conversation?.contact_name ?? "", toInbound(m));
    return;
  }
  const status = event.split(".").pop()!; // sent | delivered | read | failed
  if (!m.id || !["sent", "delivered", "read", "failed"].includes(status)) return;
  const err = m.kapso?.statuses?.find((s) => s.status === "failed")?.errors?.[0];
  const [row] = await db.update(schema.messages)
    .set({ status, ...(err ? { error: `${err.code}: ${err.message ?? err.title ?? ""}` } : {}) })
    .where(eq(schema.messages.waMessageId, m.id)).returning({ businessId: schema.messages.businessId });
  if (row && status === "failed") {
    await logEvent(row.businessId, "error", "message_failed", "וואטסאפ דחה הודעה שנשלחה", { error: err });
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-webhook-signature"))) return new Response("invalid signature", { status: 401 });

  const db = await getDb();
  const key = req.headers.get("x-idempotency-key");
  if (key) {
    const fresh = await db.insert(schema.webhookEvents).values({ key }).onConflictDoNothing().returning();
    if (!fresh.length) return new Response("OK"); // retry of a delivery we already processed
  }
  try {
    const body = JSON.parse(raw);
    const event = req.headers.get("x-webhook-event") ?? body.type ?? "";
    const items: KapsoEvent[] = body.batch && Array.isArray(body.data) ? body.data : [body];
    for (const item of items) await handle(event, item);
  } catch (e) {
    await logEvent(null, "error", "webhook_error", "שגיאה בעיבוד webhook", { error: e instanceof Error ? e.stack : String(e) });
    if (key) await db.delete(schema.webhookEvents).where(eq(schema.webhookEvents.key, key)); // let Kapso retry
    return new Response("error", { status: 500 });
  }
  return new Response("OK");
}

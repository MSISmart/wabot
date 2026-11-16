import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Business, Contact, Conversation } from "@/db/schema";
import { logEvent } from "@/lib/log";
import { kapsoConfigured, kapsoSend } from "./kapso";
import type { OutMsg } from "./types";

export const isSimContact = (waId: string) => waId.startsWith("sim-");

/** Stores an outgoing message and sends it through the provider. Simulator contacts are stored only. */
export async function deliver(
  business: Business, conversation: Conversation, contact: Contact, out: OutMsg, sentBy: "bot" | "human" | "system" = "bot",
) {
  const db = await getDb();
  const [row] = await db.insert(schema.messages).values({
    businessId: business.id, conversationId: conversation.id, direction: "out", kind: out.type,
    body: out.text, payload: out as unknown as Record<string, unknown>, sentBy, status: "pending",
  }).returning();
  await db.update(schema.conversations)
    .set({ lastMessageAt: new Date(), lastMessageText: out.text.slice(0, 120) })
    .where(eq(schema.conversations.id, conversation.id));

  let status = "sent", waMessageId: string | null = null, error: string | null = null;
  if (!isSimContact(contact.waId)) {
    try {
      if (!business.phoneNumberId) throw new Error("לעסק אין מספר וואטסאפ מחובר");
      if (!kapsoConfigured()) throw new Error("KAPSO_API_KEY לא מוגדר");
      waMessageId = await kapsoSend(business.phoneNumberId, contact.waId, out);
    } catch (e) {
      status = "failed";
      error = e instanceof Error ? e.message : String(e);
      await logEvent(business.id, "error", "send_failed", `שליחת הודעה ל-${contact.waId} נכשלה`, { error });
    }
  }
  await db.update(schema.messages).set({ status, waMessageId, error }).where(eq(schema.messages.id, row.id));
  return { ok: status === "sent", error };
}

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { deliver } from "@/engine/deliver";
import { apiBusiness } from "@/lib/auth";

/** A person answers from the inbox. The bot is paused for this conversation so it doesn't talk over them. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const access = await apiBusiness(id);
  if (!access || !/^[0-9a-f-]{36}$/i.test(cid)) return new Response("unauthorized", { status: 401 });
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return new Response("empty", { status: 400 });
  const db = await getDb();
  const [conversation] = await db.select().from(schema.conversations)
    .where(and(eq(schema.conversations.id, cid), eq(schema.conversations.businessId, id))).limit(1);
  if (!conversation) return new Response("not found", { status: 404 });
  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, conversation.contactId)).limit(1);
  await db.update(schema.conversations).set({ botPaused: true, needsHuman: false, state: null }).where(eq(schema.conversations.id, cid));
  const r = await deliver(access.business, conversation, contact, { type: "text", text: text.trim().slice(0, 4000) }, "human");
  return Response.json(r);
}

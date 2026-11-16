import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { processInbound } from "@/engine/engine";
import { apiBusiness } from "@/lib/auth";

/** The simulator talks to the real engine as a fake customer ("sim-…"), so nothing leaves the server. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await apiBusiness(id);
  if (!access) return new Response("unauthorized", { status: 401 });
  const body = (await req.json()) as { text?: string; replyId?: string; reset?: boolean };
  const waId = `sim-${access.user.id.slice(0, 8)}`;
  const db = await getDb();

  if (body.reset) {
    await db.delete(schema.contacts).where(and(eq(schema.contacts.businessId, id), eq(schema.contacts.waId, waId)));
    return Response.json({ conversationId: null });
  }
  const text = (body.text ?? "").slice(0, 1000);
  if (!text && !body.replyId) return new Response("empty", { status: 400 });
  await processInbound(id, waId, "", body.replyId ? { kind: "reply", text, replyId: body.replyId } : { kind: "text", text });
  const [c] = await db.select({ id: schema.conversations.id }).from(schema.conversations)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
    .where(and(eq(schema.contacts.businessId, id), eq(schema.contacts.waId, waId))).limit(1);
  return Response.json({ conversationId: c?.id ?? null });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await apiBusiness(id);
  if (!access) return new Response("unauthorized", { status: 401 });
  const db = await getDb();
  const [c] = await db.select({ id: schema.conversations.id }).from(schema.conversations)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
    .where(and(eq(schema.contacts.businessId, id), eq(schema.contacts.waId, `sim-${access.user.id.slice(0, 8)}`))).limit(1);
  return Response.json({ conversationId: c?.id ?? null });
}

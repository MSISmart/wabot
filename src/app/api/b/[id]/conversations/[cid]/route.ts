import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { apiBusiness } from "@/lib/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  if (!(await apiBusiness(id)) || !/^[0-9a-f-]{36}$/i.test(cid)) return new Response("unauthorized", { status: 401 });
  const db = await getDb();
  const [conversation] = await db.select().from(schema.conversations)
    .where(and(eq(schema.conversations.id, cid), eq(schema.conversations.businessId, id))).limit(1);
  if (!conversation) return new Response("not found", { status: 404 });
  const rows = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, cid))
    .orderBy(asc(schema.messages.createdAt)).limit(500);
  if (conversation.unread) await db.update(schema.conversations).set({ unread: 0 }).where(eq(schema.conversations.id, cid));
  return Response.json({
    botPaused: conversation.botPaused,
    messages: rows.map((m) => ({
      id: m.id, direction: m.direction, kind: m.kind, body: m.body, payload: m.payload, status: m.status,
      sentBy: m.sentBy, error: m.error, at: m.createdAt.toISOString(),
    })),
  });
}

import Link from "next/link";
import { DateTime } from "luxon";
import { and, desc, eq, isNotNull, notLike } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { setBotPausedAction } from "@/app/actions";
import { Chat } from "@/components/chat";
import { PageHead } from "@/components/flash";
import { requireBusiness } from "@/lib/auth";

export default async function Inbox({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ c?: string }> }) {
  const { id } = await params;
  const { c } = await searchParams;
  const { business } = await requireBusiness(id);
  const db = await getDb();
  const list = await db.select({ conv: schema.conversations, contact: schema.contacts }).from(schema.conversations)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
    .where(and(eq(schema.conversations.businessId, id), isNotNull(schema.conversations.lastMessageAt), notLike(schema.contacts.waId, "sim-%")))
    .orderBy(desc(schema.conversations.needsHuman), desc(schema.conversations.lastMessageAt)).limit(100);
  const open = list.find((x) => x.conv.id === c);
  const when = (d: Date | null) => {
    if (!d) return "";
    const t = DateTime.fromJSDate(d, { zone: business.timezone });
    return t.hasSame(DateTime.now().setZone(business.timezone), "day") ? t.toFormat("HH:mm") : t.toFormat("d/M");
  };

  return (
    <div className="max-w-5xl">
      <PageHead title="שיחות" sub="כל מה שלקוחות כתבו לעסק בוואטסאפ, וגם מה שהבוט ענה" />
      <div className="panel grid h-[calc(100vh-13rem)] min-h-[26rem] overflow-hidden md:grid-cols-[19rem_1fr]">
        <ul className={`overflow-y-auto border-line md:border-l ${open ? "hidden md:block" : ""}`}>
          {list.length === 0 && <li className="p-6 text-center text-sm text-muted">עדיין אין שיחות. הן יופיעו כאן כשלקוח יכתוב למספר של העסק.</li>}
          {list.map(({ conv, contact }) => (
            <li key={conv.id} className="border-b border-line">
              <Link href={`/b/${id}/inbox?c=${conv.id}`} className={`block px-4 py-3 hover:bg-paper ${conv.id === c ? "bg-mint" : ""}`}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{contact.name || <span dir="ltr">{contact.waId}</span>}</span>
                  <span className="shrink-0 text-[0.74rem] text-muted">{when(conv.lastMessageAt)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-muted">{conv.lastMessageText}</span>
                  {conv.needsHuman ? <span className="tag tag-warn shrink-0">מחכה לנציג</span>
                    : conv.unread > 0 ? <span className="tag tag-on shrink-0">{conv.unread}</span>
                    : conv.botPaused ? <span className="tag tag-off shrink-0">בוט מושהה</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className={`min-h-0 flex-col ${open ? "flex" : "hidden md:flex"}`}>
          {open ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <div>
                  <Link href={`/b/${id}/inbox`} className="ml-2 text-sm text-bottle md:hidden">→ חזרה</Link>
                  <span className="font-medium">{open.contact.name || "ללא שם"}</span> <span className="text-sm text-muted" dir="ltr">{open.contact.waId}</span>
                </div>
                <form action={setBotPausedAction.bind(null, id, open.conv.id, !open.conv.botPaused)}>
                  <button className="btn btn-quiet btn-sm">{open.conv.botPaused ? "להחזיר את הבוט לשיחה" : "להשהות את הבוט בשיחה"}</button>
                </form>
              </div>
              {open.conv.botPaused && <p className="bg-amber-soft px-4 py-1.5 text-sm text-amber">הבוט מושהה בשיחה הזאת והלקוח מקבל תשובות רק ממך. הבוט יחזור לענות לבד 12 שעות אחרי ההודעה האחרונה שלך, או כשתחזיר אותו.</p>}
              <div className="min-h-0 flex-1"><Chat key={open.conv.id} businessId={id} conversationId={open.conv.id} mode="inbox" /></div>
            </>
          ) : (
            <p className="m-auto max-w-64 text-center text-muted">בוחרים שיחה מהרשימה כדי לקרוא אותה ולענות.</p>
          )}
        </div>
      </div>
    </div>
  );
}

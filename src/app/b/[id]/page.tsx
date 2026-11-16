import Link from "next/link";
import { DateTime } from "luxon";
import { and, asc, count, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { PageHead } from "@/components/flash";
import { requireBusiness } from "@/lib/auth";
import { DAY_NAMES, dayIndex, fmtTime } from "@/lib/time";

export default async function Today({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await requireBusiness(id);
  const db = await getDb();
  const tz = business.timezone;
  const now = DateTime.now().setZone(tz);
  const dayStart = now.startOf("day").toJSDate(), dayEnd = now.endOf("day").toJSDate();
  const active = inArray(schema.appointments.status, ["booked", "confirmed", "completed"]);

  const today = await db.select().from(schema.appointments)
    .where(and(eq(schema.appointments.businessId, id), active, gte(schema.appointments.startAt, dayStart), lt(schema.appointments.startAt, dayEnd)))
    .orderBy(asc(schema.appointments.startAt));
  const [{ n: week }] = await db.select({ n: count() }).from(schema.appointments)
    .where(and(eq(schema.appointments.businessId, id), inArray(schema.appointments.status, ["booked", "confirmed"]), gte(schema.appointments.startAt, dayEnd), lt(schema.appointments.startAt, now.plus({ days: 7 }).toJSDate())));
  const [{ n: waiting }] = await db.select({ n: count() }).from(schema.conversations)
    .where(and(eq(schema.conversations.businessId, id), eq(schema.conversations.needsHuman, true)));
  const [{ n: msgs }] = await db.select({ n: count() }).from(schema.messages)
    .where(and(eq(schema.messages.businessId, id), eq(schema.messages.direction, "in"), gte(schema.messages.createdAt, dayStart)));
  const recent = await db.select().from(schema.events).where(eq(schema.events.businessId, id)).orderBy(desc(schema.events.createdAt)).limit(6);
  const [{ n: services }] = await db.select({ n: count() }).from(schema.services).where(and(eq(schema.services.businessId, id), eq(schema.services.active, true)));
  const [{ n: autos }] = await db.select({ n: count() }).from(schema.automations).where(and(eq(schema.automations.businessId, id), eq(schema.automations.enabled, true)));

  const todo = [
    !business.phoneNumberId && { text: "מספר הוואטסאפ עדיין לא מחובר. עד אז אפשר לנסות את הבוט במסך \"בדיקת הבוט\".", href: `/b/${id}/settings#whatsapp`, cta: "חיבור מספר" },
    services === 0 && { text: "אין שירותים פעילים, ולכן לקוחות לא יכולים לקבוע תור.", href: `/b/${id}/settings#services`, cta: "הוספת שירות" },
    autos === 0 && { text: "אין אוטומציה פעילה, ולכן הבוט לא עונה.", href: `/b/${id}/automations`, cta: "לאוטומציות" },
    !business.botEnabled && { text: "הבוט כבוי. הודעות נשמרות בשיחות אבל לא נענות.", href: `/b/${id}/inbox`, cta: "לשיחות" },
  ].filter(Boolean) as { text: string; href: string; cta: string }[];

  const nowMs = now.toMillis();
  const next = today.find((a) => a.endAt.getTime() > nowMs && a.status !== "completed");

  return (
    <div className="max-w-4xl">
      <PageHead title={`יום ${DAY_NAMES[dayIndex(now)]}, ${now.toFormat("d/M")}`}
        sub={today.length ? `${today.length} תורים היום${next ? `. הבא ב-${fmtTime(next.startAt, tz)}` : ""}` : "אין תורים היום"} />

      {todo.length > 0 && (
        <ul className="mb-6 space-y-2">
          {todo.map((t) => (
            <li key={t.href + t.cta} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#ecd9ad] bg-amber-soft px-4 py-2.5 text-sm">
              <span>{t.text}</span><Link href={t.href} className="btn btn-quiet btn-sm">{t.cta}</Link>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
        <section className="panel p-5">
          <h2 className="mb-4">התורים של היום</h2>
          {today.length === 0 ? (
            <p className="text-muted">היומן ריק היום. תורים שלקוחות קובעים בוואטסאפ יופיעו כאן.</p>
          ) : (
            <ol className="relative border-r-2 border-line pr-5">
              {today.map((a) => {
                const past = a.endAt.getTime() <= nowMs, current = a.id === next?.id;
                return (
                  <li key={a.id} className={`relative pb-5 last:pb-0 ${past ? "opacity-55" : ""}`}>
                    <span className={`absolute -right-[1.72rem] top-1.5 h-3 w-3 rounded-full border-2 border-surface ${current ? "bg-bottle ring-2 ring-mint" : past ? "bg-line" : "bg-bottle/50"}`} aria-hidden />
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-lg font-semibold tabular-nums" dir="ltr">{fmtTime(a.startAt, tz)}</span>
                      <span className="font-medium">{a.customerName || "ללא שם"}</span>
                      {a.status === "confirmed" && <span className="tag tag-on">אישר/ה הגעה</span>}
                      {current && <span className="tag tag-warn">הבא בתור</span>}
                    </div>
                    <p className="text-sm text-muted">{a.serviceName} · עד {fmtTime(a.endAt, tz)}{a.customerPhone && <> · <span dir="ltr">{a.customerPhone}</span></>}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <div className="space-y-6">
          <section className="panel divide-y divide-line">
            <Link href={`/b/${id}/appointments`} className="flex items-baseline justify-between px-5 py-3 hover:bg-paper"><span className="text-muted">תורים ב-7 הימים הבאים</span><span className="text-xl font-semibold tabular-nums">{week}</span></Link>
            <Link href={`/b/${id}/inbox`} className="flex items-baseline justify-between px-5 py-3 hover:bg-paper"><span className="text-muted">מחכים לנציג</span><span className={`text-xl font-semibold tabular-nums ${waiting ? "text-amber" : ""}`}>{waiting}</span></Link>
            <div className="flex items-baseline justify-between px-5 py-3"><span className="text-muted">הודעות מלקוחות היום</span><span className="text-xl font-semibold tabular-nums">{msgs}</span></div>
          </section>
          <section className="panel p-5">
            <h2 className="mb-3">מה קרה לאחרונה</h2>
            {recent.length === 0 ? <p className="text-sm text-muted">עוד לא קרה כלום.</p> : (
              <ul className="space-y-3 text-sm">
                {recent.map((e) => (
                  <li key={e.id}>
                    <p className={`whitespace-pre-line ${e.level === "error" ? "text-danger" : ""}`}>{e.message}</p>
                    <p className="text-[0.74rem] text-muted">{DateTime.fromJSDate(e.createdAt, { zone: tz }).toFormat("d/M HH:mm")}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

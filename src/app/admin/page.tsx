import Link from "next/link";
import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createBusinessAction, logoutAction } from "@/app/actions";
import { Flash, PageHead } from "@/components/flash";
import { Submit } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { appUrl } from "@/lib/defaults";

export default async function Admin({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireAdmin();
  const db = await getDb();
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const businesses = await db.select().from(schema.businesses).orderBy(desc(schema.businesses.createdAt));
  const msgCounts = await db.select({ id: schema.messages.businessId, n: count() }).from(schema.messages)
    .where(gte(schema.messages.createdAt, dayAgo)).groupBy(schema.messages.businessId);
  const apptCounts = await db.select({ id: schema.appointments.businessId, n: count() }).from(schema.appointments)
    .where(and(inArray(schema.appointments.status, ["booked", "confirmed"]), gte(schema.appointments.startAt, new Date()))).groupBy(schema.appointments.businessId);
  const waiting = await db.select({ id: schema.conversations.businessId, n: count() }).from(schema.conversations)
    .where(eq(schema.conversations.needsHuman, true)).groupBy(schema.conversations.businessId);
  const errors = await db.select({ id: schema.events.businessId, n: count() }).from(schema.events)
    .where(and(eq(schema.events.level, "error"), gte(schema.events.createdAt, dayAgo))).groupBy(schema.events.businessId);
  const [sysErrors] = await db.select({ n: count() }).from(schema.events)
    .where(and(isNull(schema.events.businessId), gte(schema.events.createdAt, dayAgo), sql`${schema.events.level} <> 'info'`));
  const of = (rows: { id: string | null; n: number }[], id: string) => rows.find((r) => r.id === id)?.n ?? 0;

  const env = [
    { ok: !!process.env.KAPSO_API_KEY, name: "KAPSO_API_KEY", what: "שליחת הודעות וחיבור מספרים" },
    { ok: !!process.env.KAPSO_WEBHOOK_SECRET, name: "KAPSO_WEBHOOK_SECRET", what: "אימות הודעות נכנסות" },
    { ok: !!process.env.DATABASE_URL, name: "DATABASE_URL", what: "מסד נתונים קבוע (בלי זה: מסד מקומי בתיקייה ‎.data)" },
    { ok: !!process.env.AUTH_SECRET, name: "AUTH_SECRET", what: "הצפנת התחברות" },
    { ok: !!process.env.CRON_SECRET || !process.env.VERCEL, name: "CRON_SECRET", what: "הרצת תזכורות (באירוח serverless)" },
    { ok: !!process.env.OPENAI_API_KEY, name: "OPENAI_API_KEY", what: `הבנת טקסט חופשי (לא חובה). מודל: ${process.env.OPENAI_MODEL || "gpt-4.1-nano"}` },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHead title="כל העסקים" sub={`${businesses.length} עסקים במערכת`}>
        <form action={logoutAction} className="flex items-center gap-3 text-sm text-muted">
          <span dir="ltr">{user.email}</span><button className="btn btn-quiet btn-sm">יציאה</button>
        </form>
      </PageHead>
      <Flash sp={await searchParams} />

      <div className="panel overflow-x-auto">
        {businesses.length === 0 ? (
          <p className="p-8 text-center text-muted">עדיין אין עסקים. מוסיפים את הראשון בטופס למטה.</p>
        ) : (
          <table className="w-full min-w-[640px] text-start">
            <thead className="border-b border-line text-[0.8rem] text-muted">
              <tr><th className="px-4 py-2.5 text-start font-medium">עסק</th><th className="px-3 text-start font-medium">וואטסאפ</th><th className="px-3 text-start font-medium">בוט</th>
                <th className="px-3 text-start font-medium">הודעות ב-24 שעות</th><th className="px-3 text-start font-medium">תורים קרובים</th><th className="px-3 text-start font-medium">לטיפול</th></tr>
            </thead>
            <tbody>
              {businesses.map((b) => {
                const w = of(waiting, b.id), e = of(errors, b.id);
                return (
                  <tr key={b.id} className="border-b border-line last:border-0 hover:bg-paper">
                    <td className="px-4 py-3"><Link href={`/b/${b.id}`} className="font-medium text-bottle hover:underline">{b.name}</Link></td>
                    <td className="px-3">{b.phoneNumberId ? <span className="tag tag-on" dir="ltr">{b.displayPhone ?? "מחובר"}</span> : <span className="tag tag-warn">לא מחובר</span>}</td>
                    <td className="px-3">{b.botEnabled ? <span className="tag tag-on">פעיל</span> : <span className="tag tag-off">כבוי</span>}</td>
                    <td className="px-3 tabular-nums">{of(msgCounts, b.id)}</td>
                    <td className="px-3 tabular-nums">{of(apptCounts, b.id)}</td>
                    <td className="px-3">
                      <span className="flex flex-wrap gap-1">
                        {w > 0 && <Link href={`/b/${b.id}/inbox`} className="tag tag-warn">{w} מחכים לנציג</Link>}
                        {e > 0 && <Link href={`/b/${b.id}/logs`} className="tag tag-bad">{e} שגיאות</Link>}
                        {!w && !e && <span className="text-muted">—</span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="panel p-5">
          <h2 className="mb-1">הוספת עסק</h2>
          <p className="hint mb-4">העסק נוצר עם אוטומציית קביעת תורים, שעות פעילות ברירת מחדל ושירות אחד. את הכל אפשר לערוך אחר כך.</p>
          <form action={createBusinessAction} className="space-y-3">
            <div><label className="label" htmlFor="name">שם העסק</label><input id="name" name="name" required className="input" /></div>
            <div><label className="label" htmlFor="address">כתובת</label><input id="address" name="address" className="input" /></div>
            <div><label className="label" htmlFor="ownerPhone">וואטסאפ של בעל העסק, להתראות</label><input id="ownerPhone" name="ownerPhone" dir="ltr" placeholder="972501234567" className="input" /></div>
            <Submit>הוספת העסק</Submit>
          </form>
        </section>

        <section className="panel p-5">
          <h2 className="mb-1">מצב המערכת</h2>
          <p className="hint mb-3">משתני סביבה. מה שחסר מוגדר בקובץ ‎.env או בהגדרות האירוח.</p>
          <ul className="space-y-2 text-sm">
            {env.map((e) => (
              <li key={e.name} className="flex items-start gap-2">
                <span className={`tag mt-0.5 ${e.ok ? "tag-on" : "tag-warn"}`}>{e.ok ? "מוגדר" : "חסר"}</span>
                <span><span className="font-mono text-[0.78rem]" dir="ltr">{e.name}</span><span className="block text-muted">{e.what}</span></span>
              </li>
            ))}
          </ul>
          <p className="hint mt-4">כתובת ה-webhook להודעות נכנסות:<br /><span className="font-mono text-[0.78rem]" dir="ltr">{appUrl()}/api/webhooks/kapso</span></p>
          {sysErrors.n > 0 && <p className="mt-3 text-sm text-danger">{sysErrors.n} אירועי מערכת חריגים ב-24 השעות האחרונות (הודעות למספר לא משויך או שגיאות webhook).</p>}
        </section>
      </div>
    </div>
  );
}

import Link from "next/link";
import { DateTime } from "luxon";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { PageHead } from "@/components/flash";
import { requireBusiness } from "@/lib/auth";

export default async function Logs({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ only?: string }> }) {
  const { id } = await params;
  const { user, business } = await requireBusiness(id);
  const problems = (await searchParams).only === "problems";
  const db = await getDb();
  const rows = await db.select().from(schema.events)
    .where(and(eq(schema.events.businessId, id), problems ? ne(schema.events.level, "info") : undefined))
    .orderBy(desc(schema.events.createdAt)).limit(200);
  const tag = { info: ["מידע", "tag-off"], warn: ["אזהרה", "tag-warn"], error: ["שגיאה", "tag-bad"] } as const;

  return (
    <div className="max-w-4xl">
      <PageHead title="יומן אירועים" sub="מה הבוט עשה, ומה לא הצליח">
        <div className="flex gap-1 text-sm">
          <Link href={`/b/${id}/logs`} className={`btn btn-sm ${problems ? "btn-quiet" : "btn-primary"}`}>הכל</Link>
          <Link href={`/b/${id}/logs?only=problems`} className={`btn btn-sm ${problems ? "btn-primary" : "btn-quiet"}`}>רק בעיות</Link>
        </div>
      </PageHead>
      <div className="panel">
        {rows.length === 0 ? <p className="p-8 text-center text-muted">{problems ? "אין בעיות. הכל עובד." : "עוד אין אירועים."}</p> : (
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3">
                <span className="w-24 shrink-0 text-sm tabular-nums text-muted">{DateTime.fromJSDate(e.createdAt, { zone: business.timezone }).toFormat("d/M HH:mm")}</span>
                <span className={`tag ${tag[e.level][1]}`}>{tag[e.level][0]}</span>
                <span className="min-w-0 flex-1">
                  <span className="whitespace-pre-line">{e.message}</span>
                  {user.role === "admin" && e.data && (
                    <details className="mt-1 text-[0.78rem] text-muted"><summary className="cursor-pointer">פרטים טכניים</summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-paper p-2 text-start" dir="ltr">{JSON.stringify(e.data, null, 2)}</pre></details>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

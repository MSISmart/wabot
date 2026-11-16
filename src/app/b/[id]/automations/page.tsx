import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addAutomationAction, deleteAutomationAction, toggleAutomationAction } from "@/app/actions";
import { Flash, PageHead } from "@/components/flash";
import { Submit } from "@/components/ui";
import { TEMPLATES } from "@/engine/templates";
import { requireBusiness } from "@/lib/auth";

export default async function Automations({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  await requireBusiness(id);
  const db = await getDb();
  const list = await db.select().from(schema.automations).where(eq(schema.automations.businessId, id)).orderBy(asc(schema.automations.createdAt));
  const defaults = list.filter((a) => a.enabled && a.trigger.type === "default").length;

  return (
    <div className="max-w-4xl">
      <PageHead title="אוטומציות" sub="מה הבוט עושה כשלקוח כותב לעסק" />
      <Flash sp={await searchParams} />
      {defaults === 0 && list.length > 0 && <p className="mb-4 rounded-lg border border-[#ecd9ad] bg-amber-soft px-4 py-2.5 text-sm">אין אוטומציה פעילה שעונה לכל הודעה. הבוט יענה רק להודעות עם מילות מפתח.</p>}
      {defaults > 1 && <p className="mb-4 rounded-lg border border-[#ecd9ad] bg-amber-soft px-4 py-2.5 text-sm">יש יותר מאוטומציה אחת שעונה לכל הודעה. רק הוותיקה מביניהן תופעל.</p>}

      <div className="space-y-3">
        {list.length === 0 && <p className="panel p-8 text-center text-muted">אין עדיין אוטומציות. מוסיפים אחת מהתבניות שלמטה.</p>}
        {list.map((a) => (
          <div key={a.id} className="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2"><span className="text-[1.02rem] font-semibold">{a.name}</span>
                {a.enabled ? <span className="tag tag-on">פעילה</span> : <span className="tag tag-off">כבויה</span>}</p>
              <p className="text-sm text-muted">
                {a.trigger.type === "default" ? "מופעלת בכל הודעה שלא שייכת לאוטומציה אחרת" : `מופעלת כשההודעה מכילה: ${a.trigger.keywords.join(", ")}`}
                {` · ${a.definition.steps.length} שלבים`}
              </p>
            </div>
            <form action={toggleAutomationAction.bind(null, id, a.id)}><Submit className="btn btn-quiet btn-sm">{a.enabled ? "כיבוי" : "הפעלה"}</Submit></form>
            <Link href={`/b/${id}/automations/${a.id}`} className="btn btn-primary btn-sm">עריכת הטקסטים</Link>
            <form action={deleteAutomationAction.bind(null, id, a.id)}><Submit className="btn btn-danger btn-sm" confirm={`למחוק את האוטומציה "${a.name}"?`}>מחיקה</Submit></form>
          </div>
        ))}
      </div>

      <h2 className="mt-10 mb-1">הוספה מתבנית</h2>
      <p className="hint mb-4">כל תבנית נוספת כהעתק של העסק הזה, ואפשר לשנות בה כל הודעה.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <form key={t.key} action={addAutomationAction.bind(null, id, t.key)} className="panel flex flex-col p-5">
            <p className="font-semibold">{t.name}</p>
            <p className="mt-1 mb-4 flex-1 text-sm text-muted">{t.description}</p>
            <Submit className="btn btn-quiet btn-sm self-start">הוספה לעסק</Submit>
          </form>
        ))}
      </div>
    </div>
  );
}

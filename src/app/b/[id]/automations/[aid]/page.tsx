import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { saveAutomationAction } from "@/app/actions";
import { Flash, PageHead } from "@/components/flash";
import { Submit } from "@/components/ui";
import type { Step } from "@/engine/types";
import { requireBusiness } from "@/lib/auth";

const TYPE: Record<Step["type"], [string, string]> = {
  message: ["הודעה", "הבוט שולח הודעה וממשיך"],
  menu: ["תפריט", "הלקוח בוחר אחת מהאפשרויות"],
  ask: ["שאלה", "הבוט שואל ושומר את התשובה"],
  pick_service: ["בחירת שירות", "רשימת השירותים הפעילים מההגדרות. אם יש שירות אחד, השלב מדולג"],
  pick_day: ["בחירת יום", "רק ימים שיש בהם שעה פנויה"],
  pick_time: ["בחירת שעה", "רק שעות פנויות, לפי שעות הפעילות והתורים הקיימים"],
  confirm_booking: ["אישור לפני קביעה", "כפתורים: אישור, שינוי מועד, ביטול"],
  create_booking: ["קביעת התור", "התור נשמר, נקבעת תזכורת ובעל העסק מקבל התראה"],
  my_appointments: ["התורים שלי", "הלקוח רואה את התורים שלו ויכול לבטל"],
  notify_owner: ["התראה לבעל העסק", "נשלחת לבעל העסק, לא ללקוח"],
  handoff: ["העברה לנציג", "הבוט מושהה בשיחה עד שמחזירים אותו"],
};
const FIELDS: [string, string][] = [
  ["text", "ההודעה"], ["successText", "הודעה כשהתור נקבע"], ["takenText", "הודעה כשהשעה נתפסה בינתיים"],
  ["noSlotsText", "הודעה כשאין תורים פנויים"], ["cancelText", "הודעה כשהלקוח מבטל"],
  ["emptyText", "הודעה כשאין ללקוח תורים"], ["cancelledText", "הודעה אחרי ביטול תור"],
];
const VARS = ["business", "name", "service", "date", "time", "address", "hours", "phone"];

export default async function EditAutomation({ params, searchParams }: { params: Promise<{ id: string; aid: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id, aid } = await params;
  await requireBusiness(id);
  const db = await getDb();
  const [a] = /^[0-9a-f-]{36}$/i.test(aid)
    ? await db.select().from(schema.automations).where(and(eq(schema.automations.id, aid), eq(schema.automations.businessId, id))).limit(1) : [];
  if (!a) redirect(`/b/${id}/automations`);
  const nameOf = (stepId?: string) => { const s = a.definition.steps.find((x) => x.id === stepId); return s ? TYPE[s.type][0] : "סיום"; };

  return (
    <div className="max-w-3xl">
      <Link href={`/b/${id}/automations`} className="mb-3 inline-block text-sm text-bottle hover:underline">→ כל האוטומציות</Link>
      <PageHead title={a.name} sub="משנים את הניסוח של כל שלב. סדר השלבים קבוע לפי התבנית" />
      <Flash sp={await searchParams} />

      <form action={saveAutomationAction.bind(null, id, aid)}>
        <section className="panel mb-6 space-y-4 p-5">
          <div><label className="label" htmlFor="name">שם האוטומציה</label><input id="name" name="name" defaultValue={a.name} className="input max-w-sm" /></div>
          {a.trigger.type === "keywords" ? (
            <div><label className="label" htmlFor="keywords">מילות מפתח שמפעילות אותה, מופרדות בפסיקים</label>
              <input id="keywords" name="keywords" defaultValue={a.trigger.keywords.join(", ")} className="input" /></div>
          ) : <p className="hint">האוטומציה הזאת מופעלת בכל הודעה שלא מכילה מילת מפתח של אוטומציה אחרת.</p>}
          <p className="hint">בתוך הודעות אפשר לשלב משתנים: {VARS.map((v) => <code key={v} dir="ltr" className="mx-0.5 rounded bg-paper px-1 text-[0.78rem]">{`{{${v}}}`}</code>)}</p>
        </section>

        <ol className="space-y-3">
          {a.definition.steps.map((step, i) => {
            const st = step as Step & Record<string, string | undefined>;
            return (
              <li key={step.id} className="panel p-5">
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-mint text-[0.78rem] font-semibold text-bottle-deep">{i + 1}</span>
                  <h2>{TYPE[step.type][0]}</h2>
                  <span className="text-sm text-muted">{TYPE[step.type][1]}</span>
                  {step.id === a.definition.start && <span className="tag tag-on">שלב פתיחה</span>}
                </div>
                <div className="space-y-3">
                  {FIELDS.filter(([f]) => f in step).map(([f, label]) => (
                    <div key={f}>
                      <label className="label" htmlFor={`${step.id}-${f}`}>{label}</label>
                      <textarea id={`${step.id}-${f}`} name={`f:${step.id}:${f}`} defaultValue={st[f]} required className="input" rows={Math.min(8, (st[f] ?? "").split("\n").length + 1)} />
                    </div>
                  ))}
                  {step.type === "menu" && (
                    <fieldset>
                      <legend className="label">האפשרויות בתפריט (עד 24 תווים לכותרת){step.options.length <= 3 && ". עד 3 אפשרויות קצרות מוצגות ככפתורים"}</legend>
                      <div className="space-y-2">
                        {step.options.map((o) => (
                          <div key={o.id} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-center">
                            <input name={`o:${step.id}:${o.id}:label`} defaultValue={o.label} maxLength={24} required aria-label="כותרת האפשרות" className="input" />
                            <input name={`o:${step.id}:${o.id}:description`} defaultValue={o.description ?? ""} maxLength={72} placeholder="תיאור קצר (לא חובה)" aria-label="תיאור האפשרות" className="input" />
                            <span className="text-sm text-muted">מוביל אל: {nameOf(o.next)}</span>
                          </div>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  {step.type !== "menu" && step.type !== "handoff" && <p className="text-sm text-muted">אחר כך: {nameOf(step.next)}</p>}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="sticky bottom-0 mt-4 flex gap-2 border-t border-line bg-paper/95 py-3">
          <Submit>שמירת השינויים</Submit>
          <Link href={`/b/${id}/simulator`} className="btn btn-quiet">לבדיקת הבוט</Link>
        </div>
      </form>
    </div>
  );
}

import { DateTime } from "luxon";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addAppointmentAction, cancelAppointmentAction } from "@/app/actions";
import { Flash, PageHead } from "@/components/flash";
import { Submit } from "@/components/ui";
import { requireBusiness } from "@/lib/auth";
import { fmtDay, fmtTime, isoDate, relativeDayLabel } from "@/lib/time";

const STATUS: Record<string, [string, string]> = {
  booked: ["נקבע", "tag-off"], confirmed: ["אישר/ה הגעה", "tag-on"], cancelled: ["בוטל", "tag-bad"], completed: ["התקיים", "tag-off"],
};

export default async function Appointments({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const { business } = await requireBusiness(id);
  const db = await getDb();
  const tz = business.timezone;
  const now = DateTime.now().setZone(tz);
  const upcoming = await db.select().from(schema.appointments)
    .where(and(eq(schema.appointments.businessId, id), inArray(schema.appointments.status, ["booked", "confirmed"]), gte(schema.appointments.endAt, now.toJSDate())))
    .orderBy(asc(schema.appointments.startAt)).limit(300);
  const past = await db.select().from(schema.appointments)
    .where(and(eq(schema.appointments.businessId, id), lt(schema.appointments.startAt, now.toJSDate())))
    .orderBy(desc(schema.appointments.startAt)).limit(40);
  const services = await db.select().from(schema.services).where(and(eq(schema.services.businessId, id), eq(schema.services.active, true))).orderBy(asc(schema.services.sort));

  const days = new Map<string, typeof upcoming>();
  for (const a of upcoming) {
    const d = isoDate(a.startAt, tz);
    days.set(d, [...(days.get(d) ?? []), a]);
  }

  return (
    <div className="max-w-4xl">
      <PageHead title="תורים" sub={upcoming.length ? `${upcoming.length} תורים קרובים` : "אין תורים קרובים"} />
      <Flash sp={await searchParams} />

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-5">
          {days.size === 0 && <p className="panel p-8 text-center text-muted">כשלקוח יקבע תור בוואטסאפ, או כשתוסיפו תור ידנית, הוא יופיע כאן.</p>}
          {[...days.entries()].map(([d, list]) => (
            <section key={d} className="panel">
              <h2 className="flex items-baseline gap-2 border-b border-line px-5 py-3">
                {fmtDay(d, tz)} {relativeDayLabel(d, now) && <span className="tag tag-on">{relativeDayLabel(d, now)}</span>}
                <span className="mr-auto text-sm font-normal text-muted">{list.length} תורים</span>
              </h2>
              <ul className="divide-y divide-line">
                {list.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <span className="w-12 font-semibold tabular-nums" dir="ltr">{fmtTime(a.startAt, tz)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{a.customerName || "ללא שם"}</span>
                      <span className="block text-sm text-muted">{a.serviceName}{a.customerPhone && <> · <span dir="ltr">{a.customerPhone}</span></>}{a.source === "manual" && " · נוסף ידנית"}{a.notes && ` · ${a.notes}`}</span>
                    </span>
                    <span className={`tag ${STATUS[a.status][1]}`}>{STATUS[a.status][0]}</span>
                    <form action={cancelAppointmentAction.bind(null, id, a.id)}>
                      <Submit className="btn btn-danger btn-sm" confirm={`לבטל את התור של ${a.customerName || "הלקוח"}?`}>ביטול התור</Submit>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {past.length > 0 && (
            <details className="panel">
              <summary className="cursor-pointer px-5 py-3 font-medium">תורים קודמים ({past.length} האחרונים)</summary>
              <ul className="divide-y divide-line border-t border-line text-sm">
                {past.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-4 px-5 py-2">
                    <span className="w-28 tabular-nums text-muted">{DateTime.fromJSDate(a.startAt, { zone: tz }).toFormat("d/M HH:mm")}</span>
                    <span className="flex-1">{a.customerName || "ללא שם"} · {a.serviceName}</span>
                    <span className={`tag ${STATUS[a.status][1]}`}>{STATUS[a.status][0]}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <section className="panel h-fit p-5">
          <h2 className="mb-1">הוספת תור ידנית</h2>
          <p className="hint mb-4">לתור שנקבע בטלפון או במקום. השעה נחסמת גם לבוט.</p>
          {services.length === 0 ? <p className="text-sm text-muted">קודם צריך להוסיף שירות בהגדרות.</p> : (
            <form action={addAppointmentAction.bind(null, id)} className="space-y-3">
              <div><label className="label" htmlFor="a-name">שם הלקוח</label><input id="a-name" name="name" required className="input" /></div>
              <div><label className="label" htmlFor="a-phone">טלפון (לא חובה)</label><input id="a-phone" name="phone" dir="ltr" placeholder="972501234567" className="input" /></div>
              <div><label className="label" htmlFor="a-svc">שירות</label>
                <select id="a-svc" name="serviceId" className="input">{services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.durationMin} דק׳)</option>)}</select></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label" htmlFor="a-date">תאריך</label><input id="a-date" name="date" type="date" required min={now.toISODate()!} defaultValue={now.toISODate()!} className="input" /></div>
                <div><label className="label" htmlFor="a-time">שעה</label><input id="a-time" name="time" type="time" required step={300} className="input" /></div>
              </div>
              <div><label className="label" htmlFor="a-notes">הערה (לא חובה)</label><input id="a-notes" name="notes" className="input" /></div>
              <Submit>הוספת התור</Submit>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

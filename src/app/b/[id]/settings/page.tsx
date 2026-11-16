import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  addServiceAction, createOwnerUserAction, createSetupLinkAction, deleteBusinessAction, deleteUserAction, registerWebhookAction,
  saveBookingSettingsAction, saveBusinessAction, saveHoursAction, savePhoneNumberAction, updateServiceAction,
} from "@/app/actions";
import { Flash, PageHead } from "@/components/flash";
import { CopyField, Submit } from "@/components/ui";
import { kapsoConfigured } from "@/engine/kapso";
import { requireBusiness } from "@/lib/auth";
import { appUrl } from "@/lib/defaults";
import { DAY_NAMES } from "@/lib/time";

export default async function Settings({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const { user, business: b } = await requireBusiness(id);
  const admin = user.role === "admin";
  const db = await getDb();
  const services = await db.select().from(schema.services).where(eq(schema.services.businessId, id)).orderBy(asc(schema.services.sort), asc(schema.services.name));
  const owners = admin ? await db.select().from(schema.users).where(and(eq(schema.users.businessId, id), eq(schema.users.role, "owner"))) : [];
  const st = b.settings;
  const aiReady = !!process.env.OPENAI_API_KEY && !!process.env.OPENAI_MODEL;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHead title="הגדרות" />
      <Flash sp={await searchParams} />

      <section className="panel p-5">
        <h2 className="mb-4">פרטי העסק</h2>
        <form action={saveBusinessAction.bind(null, id)} className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="name">שם העסק</label><input id="name" name="name" defaultValue={b.name} required className="input" /></div>
          <div><label className="label" htmlFor="ownerPhone">וואטסאפ של בעל העסק, להתראות</label><input id="ownerPhone" name="ownerPhone" defaultValue={b.ownerPhone} dir="ltr" placeholder="972501234567" className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="address">כתובת</label><input id="address" name="address" defaultValue={b.address} className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="about">מידע נוסף על העסק</label>
            <textarea id="about" name="about" defaultValue={b.about} className="input" placeholder="חניה, אמצעי תשלום, מדיניות ביטולים…" />
            <p className="hint mt-1">משמש את ה-AI כדי לענות על שאלות של לקוחות. הוא עונה רק מתוך מה שכתוב כאן.</p></div>
          <div><Submit>שמירת פרטי העסק</Submit></div>
        </form>
      </section>

      <section className="panel p-5" id="services">
        <h2 className="mb-1">שירותים</h2>
        <p className="hint mb-4">מה שלקוחות יכולים לקבוע. משך השירות קובע כמה זמן נחסם ביומן.</p>
        <div className="space-y-2">
          {services.map((s) => (
            <form key={s.id} action={updateServiceAction.bind(null, id, s.id)} className="grid grid-cols-2 items-end gap-2 border-b border-line pb-3 sm:grid-cols-[1fr_6rem_6rem_auto_auto_auto] sm:border-0 sm:pb-0">
              <div className="col-span-2 sm:col-span-1"><label className="label sm:sr-only" htmlFor={`n-${s.id}`}>שם</label><input id={`n-${s.id}`} name="name" defaultValue={s.name} required className="input" /></div>
              <div><label className="label sm:sr-only" htmlFor={`d-${s.id}`}>דקות</label><input id={`d-${s.id}`} name="durationMin" type="number" min={5} step={5} defaultValue={s.durationMin} className="input" title="משך בדקות" /></div>
              <div><label className="label sm:sr-only" htmlFor={`p-${s.id}`}>מחיר ₪</label><input id={`p-${s.id}`} name="price" type="number" min={0} defaultValue={s.price ?? ""} placeholder="₪" className="input" title="מחיר בשקלים" /></div>
              <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={s.active} /> פעיל</label>
              <Submit className="btn btn-quiet btn-sm mb-1">שמירה</Submit>
              <button name="intent" value="delete" className="btn btn-danger btn-sm mb-1">מחיקה</button>
            </form>
          ))}
          {services.length === 0 && <p className="text-sm text-muted">אין שירותים. בלי שירות אחד לפחות אי אפשר לקבוע תור.</p>}
        </div>
        <form action={addServiceAction.bind(null, id)} className="mt-4 grid grid-cols-2 items-end gap-2 border-t border-line pt-4 sm:grid-cols-[1fr_6rem_6rem_auto]">
          <div className="col-span-2 sm:col-span-1"><label className="label" htmlFor="svc-new">שירות חדש</label><input id="svc-new" name="name" required placeholder="למשל: תספורת" className="input" /></div>
          <div><label className="label" htmlFor="svc-dur">דקות</label><input id="svc-dur" name="durationMin" type="number" min={5} step={5} defaultValue={30} className="input" /></div>
          <div><label className="label" htmlFor="svc-price">מחיר ₪</label><input id="svc-price" name="price" type="number" min={0} className="input" /></div>
          <Submit className="btn btn-primary mb-px">הוספת שירות</Submit>
        </form>
      </section>

      <section className="panel p-5">
        <h2 className="mb-1">שעות פעילות</h2>
        <p className="hint mb-4">הבוט מציע תורים רק בשעות האלה. טווח שני באותו יום מאפשר הפסקת צהריים.</p>
        <form action={saveHoursAction.bind(null, id)}>
          <div className="space-y-2">
            {DAY_NAMES.map((name, d) => {
              const r = b.hours[String(d)] ?? [];
              return (
                <div key={d} className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[5.5rem_auto_auto_1fr]">
                  <label className="flex items-center gap-2 font-medium"><input type="checkbox" name={`open:${d}`} defaultChecked={r.length > 0} /> {name}</label>
                  <span className="flex items-center gap-1.5" dir="ltr">
                    <input type="time" name={`from:${d}:a`} defaultValue={r[0]?.[0] ?? ""} className="input !w-28" aria-label={`${name}: פתיחה`} /> –
                    <input type="time" name={`to:${d}:a`} defaultValue={r[0]?.[1] ?? ""} className="input !w-28" aria-label={`${name}: סגירה`} />
                  </span>
                  <span className="col-start-2 flex items-center gap-1.5 sm:col-start-auto" dir="ltr">
                    <input type="time" name={`from:${d}:b`} defaultValue={r[1]?.[0] ?? ""} className="input !w-28" aria-label={`${name}: פתיחה, טווח שני`} /> –
                    <input type="time" name={`to:${d}:b`} defaultValue={r[1]?.[1] ?? ""} className="input !w-28" aria-label={`${name}: סגירה, טווח שני`} />
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-4"><Submit>שמירת שעות הפעילות</Submit></div>
        </form>
      </section>

      <section className="panel p-5">
        <h2 className="mb-4">הגדרות תורים ותזכורות</h2>
        <form action={saveBookingSettingsAction.bind(null, id)} className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="slotMinutes">מרווח בין שעות מוצעות (דקות)</label><input id="slotMinutes" name="slotMinutes" type="number" min={5} step={5} defaultValue={st.slotMinutes} className="input" /></div>
          <div><label className="label" htmlFor="leadMinutes">כמה דקות מראש לפחות אפשר לקבוע</label><input id="leadMinutes" name="leadMinutes" type="number" min={0} defaultValue={st.leadMinutes} className="input" /></div>
          <div><label className="label" htmlFor="maxDaysAhead">כמה ימים קדימה אפשר לקבוע</label><input id="maxDaysAhead" name="maxDaysAhead" type="number" min={1} max={90} defaultValue={st.maxDaysAhead} className="input" /></div>
          <div><label className="label" htmlFor="reminderHours">תזכורת: כמה שעות לפני התור</label><input id="reminderHours" name="reminderHours" type="number" min={1} max={168} defaultValue={st.reminderHours} className="input" /></div>
          <div><label className="label" htmlFor="reminderTemplate">שם תבנית התזכורת המאושרת בוואטסאפ</label><input id="reminderTemplate" name="reminderTemplate" defaultValue={st.reminderTemplate ?? ""} dir="ltr" placeholder="appointment_reminder" className="input" /></div>
          <div><label className="label" htmlFor="reminderTemplateLang">שפת התבנית</label><input id="reminderTemplateLang" name="reminderTemplateLang" defaultValue={st.reminderTemplateLang ?? "he"} dir="ltr" className="input" /></div>
          <p className="hint sm:col-span-2">וואטסאפ מאפשר הודעה חופשית רק עד 24 שעות אחרי ההודעה האחרונה של הלקוח. אחרי זה תזכורת נשלחת רק דרך תבנית מאושרת, עם 4 משתנים בגוף ההודעה: שם, שירות, יום, שעה. בלי תבנית, תזכורות מאוחרות לא נשלחות ונרשמות ביומן האירועים.</p>
          <label className="flex items-start gap-2 sm:col-span-2">
            <input type="checkbox" name="aiEnabled" defaultChecked={st.aiEnabled} className="mt-1" />
            <span>להבין הודעות חופשיות בעזרת AI
              <span className="hint block">למשל "אפשר תור מחר אחרי 5?". ה-AI רק מבין את הבקשה. את התור קובעת תמיד הלוגיקה הרגילה, מול השעות הפנויות באמת.{!aiReady && " כרגע לא פעיל: חסרים OPENAI_API_KEY ו-OPENAI_MODEL במשתני הסביבה."}</span></span>
          </label>
          <div><Submit>שמירת ההגדרות</Submit></div>
        </form>
      </section>

      <section className="panel p-5" id="whatsapp">
        <h2 className="mb-1">חיבור וואטסאפ</h2>
        {b.phoneNumberId
          ? <p className="mb-4"><span className="tag tag-on">מחובר</span> <span dir="ltr">{b.displayPhone ?? ""}</span> <span className="text-sm text-muted">מזהה מספר: <span dir="ltr">{b.phoneNumberId}</span></span></p>
          : <p className="mb-4"><span className="tag tag-warn">לא מחובר</span> <span className="text-sm text-muted">{admin ? "שולחים לבעל העסק לינק חיבור, או מזינים מזהה מספר ידנית." : "החיבור נעשה על ידי מנהל המערכת."}</span></p>}
        {admin && (
          <div className="space-y-5">
            {!kapsoConfigured() && <p className="rounded-lg bg-amber-soft px-4 py-2.5 text-sm">KAPSO_API_KEY עדיין לא מוגדר, ולכן אי אפשר ליצור לינק חיבור או לשלוח הודעות אמיתיות. הסימולטור עובד בלי זה.</p>}
            <div>
              <form action={createSetupLinkAction.bind(null, id)}><Submit className="btn btn-quiet">{b.setupLinkUrl ? "יצירת לינק חיבור חדש" : "יצירת לינק חיבור"}</Submit></form>
              {b.setupLinkUrl && <div className="mt-3"><CopyField label="לינק לשליחה לבעל העסק (תקף 30 יום)" value={b.setupLinkUrl} /></div>}
              <p className="hint mt-2">בעל העסק פותח את הלינק, מתחבר עם פייסבוק ובוחר את המספר. אחרי זה המספר נשמר כאן וה-webhook נרשם לבד.</p>
            </div>
            <form action={savePhoneNumberAction.bind(null, id)} className="grid items-end gap-2 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_auto]">
              <div><label className="label" htmlFor="phoneNumberId">מזהה מספר (Phone Number ID), להזנה ידנית</label><input id="phoneNumberId" name="phoneNumberId" defaultValue={b.phoneNumberId ?? ""} dir="ltr" className="input" /></div>
              <div><label className="label" htmlFor="displayPhone">המספר כפי שיוצג</label><input id="displayPhone" name="displayPhone" defaultValue={b.displayPhone ?? ""} dir="ltr" className="input" /></div>
              <Submit className="btn btn-quiet">שמירת המספר</Submit>
            </form>
            <div className="border-t border-line pt-4">
              <CopyField label="כתובת ה-webhook של המערכת" value={`${appUrl()}/api/webhooks/kapso`} />
              <form action={registerWebhookAction.bind(null, id)} className="mt-3"><Submit className="btn btn-quiet">רישום ה-webhook ב-Kapso למספר הזה</Submit></form>
            </div>
          </div>
        )}
      </section>

      {admin && (
        <section className="panel p-5">
          <h2 className="mb-1">כניסה לבעל העסק</h2>
          <p className="hint mb-4">משתמש כזה רואה ומנהל רק את העסק הזה.</p>
          {owners.length > 0 && (
            <ul className="mb-4 divide-y divide-line border-y border-line">
              {owners.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{o.name && `${o.name} · `}<span dir="ltr">{o.email}</span></span>
                  <form action={deleteUserAction.bind(null, id, o.id)}><Submit className="btn btn-danger btn-sm" confirm="להסיר את המשתמש?">הסרה</Submit></form>
                </li>
              ))}
            </ul>
          )}
          <form action={createOwnerUserAction.bind(null, id)} className="grid items-end gap-2 sm:grid-cols-[1fr_1.3fr_1fr_auto]">
            <div><label className="label" htmlFor="o-name">שם</label><input id="o-name" name="name" className="input" /></div>
            <div><label className="label" htmlFor="o-email">אימייל</label><input id="o-email" name="email" type="email" required dir="ltr" className="input" /></div>
            <div><label className="label" htmlFor="o-pass">סיסמה (8+)</label><input id="o-pass" name="password" type="text" required minLength={8} dir="ltr" autoComplete="off" className="input" /></div>
            <Submit className="btn btn-quiet">יצירת משתמש</Submit>
          </form>
        </section>
      )}

      {admin && (
        <section className="rounded-xl border border-[#e6c2ba] p-5">
          <h2 className="mb-1 text-danger">מחיקת העסק</h2>
          <p className="hint mb-3">מוחק את העסק עם כל השיחות, התורים והאוטומציות שלו. אי אפשר לשחזר.</p>
          <form action={deleteBusinessAction.bind(null, id)} className="flex flex-wrap items-end gap-2">
            <div><label className="label" htmlFor="confirm">לאישור, מקלידים את שם העסק: {b.name}</label><input id="confirm" name="confirm" autoComplete="off" className="input" /></div>
            <Submit className="btn btn-danger">מחיקת העסק לצמיתות</Submit>
          </form>
        </section>
      )}
    </div>
  );
}

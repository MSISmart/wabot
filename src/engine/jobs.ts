import { and, asc, eq, inArray, lt, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { logEvent } from "@/lib/log";
import { fmtDay, fmtTime, isoDate } from "@/lib/time";
import { deliver } from "./deliver";

const WINDOW_MS = 24 * 3600_000;

async function sendReminder(appointmentId: string) {
  const db = await getDb();
  const [appt] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId)).limit(1);
  if (!appt || appt.status !== "booked" || appt.startAt < new Date() || !appt.contactId) return;
  const [business] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, appt.businessId)).limit(1);
  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, appt.contactId)).limit(1);
  const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.contactId, appt.contactId)).limit(1);
  if (!business || !contact || !conversation) return;

  const tz = business.timezone;
  const day = fmtDay(isoDate(appt.startAt, tz), tz), time = fmtTime(appt.startAt, tz);
  const text = `היי ${appt.customerName || ""} 👋 תזכורת לתור ב${business.name}:\n${appt.serviceName}, ${day} בשעה ${time}.\nמגיעים?`;
  const windowOpen = contact.waId.startsWith("sim-")
    || (conversation.lastInboundAt && Date.now() - conversation.lastInboundAt.getTime() < WINDOW_MS);

  if (windowOpen) {
    const r = await deliver(business, conversation, contact, {
      type: "buttons", text,
      buttons: [{ id: `appt:ok:${appt.id}`, title: "מגיע/ה ✅" }, { id: `appt:no:${appt.id}`, title: "ביטול התור" }],
    }, "system");
    if (!r.ok) throw new Error(r.error ?? "send failed");
  } else if (business.settings.reminderTemplate) {
    // Outside WhatsApp's 24-hour window only an approved template may be sent.
    const r = await deliver(business, conversation, contact, {
      type: "template", name: business.settings.reminderTemplate, language: business.settings.reminderTemplateLang || "he",
      params: [appt.customerName || "לקוח/ה", appt.serviceName, day, time], text,
    }, "system");
    if (!r.ok) throw new Error(r.error ?? "send failed");
  } else {
    await logEvent(business.id, "warn", "reminder_skipped",
      `תזכורת ל-${appt.customerName} לא נשלחה: עברו יותר מ-24 שעות מההודעה האחרונה של הלקוח ולא הוגדרה תבנית תזכורת`, { appointmentId });
  }
}

/** Runs due jobs. Called every minute by the built-in timer (self-hosted) or by an external cron hitting /api/cron/tick. */
export async function runDueJobs(limit = 25) {
  const db = await getDb();
  const now = new Date();
  const due = await db.select().from(schema.jobs)
    .where(and(eq(schema.jobs.status, "pending"), lte(schema.jobs.runAt, now)))
    .orderBy(asc(schema.jobs.runAt)).limit(limit);
  let done = 0, failed = 0;
  for (const job of due) {
    // Claim the job first so two overlapping ticks never send the same reminder twice.
    const claimed = await db.update(schema.jobs).set({ status: "done", attempts: job.attempts + 1 })
      .where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.status, "pending"))).returning({ id: schema.jobs.id });
    if (!claimed.length) continue;
    try {
      if (job.type === "reminder") await sendReminder(job.payload.appointmentId);
      done++;
    } catch (e) {
      failed++;
      const retry = job.attempts + 1 < 3;
      await db.update(schema.jobs).set({
        status: retry ? "pending" : "failed", lastError: String(e), runAt: new Date(Date.now() + 5 * 60_000),
      }).where(eq(schema.jobs.id, job.id));
      await logEvent(job.businessId, "error", "job_failed", `משימה מתוזמנת נכשלה (${job.type})`, { error: String(e) });
    }
  }
  // Past appointments become "completed".
  await db.update(schema.appointments).set({ status: "completed" })
    .where(and(inArray(schema.appointments.status, ["booked", "confirmed"]), lt(schema.appointments.endAt, now)));
  return { due: due.length, done, failed };
}

let lastOpportunistic = 0;
/**
 * Reminders must not depend on one scheduler. Besides the external cron, any webhook or panel visit
 * also runs due jobs, at most once a minute per server instance. Claiming makes double runs harmless.
 */
export function runDueJobsSoon() {
  if (Date.now() - lastOpportunistic < 60_000) return;
  lastOpportunistic = Date.now();
  return runDueJobs(10).catch((e) => console.error("opportunistic tick failed", e));
}

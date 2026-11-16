import { DateTime } from "luxon";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Appointment, Business } from "@/db/schema";
import { logEvent } from "@/lib/log";
import { fmtDateTime } from "@/lib/time";
import { kapsoConfigured, kapsoSend } from "./kapso";

/** Tells the business owner about something. Always logged; also sent on WhatsApp when a number is connected. */
export async function notifyOwner(business: Business, text: string) {
  await logEvent(business.id, "info", "owner_notify", text);
  if (!business.ownerPhone || !business.phoneNumberId || !kapsoConfigured()) return;
  try {
    await kapsoSend(business.phoneNumberId, business.ownerPhone, { type: "text", text });
  } catch (e) {
    await logEvent(business.id, "warn", "owner_notify_failed",
      "לא הצלחתי לשלוח התראה לבעל העסק בוואטסאפ (ייתכן שחלון 24 השעות סגור)", { error: String(e) });
  }
}

export async function scheduleReminder(business: Business, appt: Appointment, now = new Date()) {
  const start = appt.startAt.getTime();
  let runAt = start - business.settings.reminderHours * 3600_000;
  if (runAt <= now.getTime()) runAt = start - 2 * 3600_000; // booked late: remind two hours before instead
  if (runAt <= now.getTime()) return;
  const db = await getDb();
  await db.insert(schema.jobs).values({
    businessId: business.id, type: "reminder", runAt: new Date(runAt), payload: { appointmentId: appt.id },
  });
}

export async function cancelAppointment(business: Business, appointmentId: string, by: "customer" | "business") {
  const db = await getDb();
  const [appt] = await db.update(schema.appointments).set({ status: "cancelled" })
    .where(and(eq(schema.appointments.id, appointmentId), eq(schema.appointments.businessId, business.id)))
    .returning();
  if (!appt) return null;
  await db.update(schema.jobs).set({ status: "cancelled" })
    .where(and(eq(schema.jobs.status, "pending"), sql`${schema.jobs.payload}->>'appointmentId' = ${appointmentId}`));
  if (by === "customer") {
    await notifyOwner(business, `תור בוטל ❌\n${appt.customerName} (${appt.customerPhone})\n${appt.serviceName}, ${fmtDateTime(appt.startAt, business.timezone)}`);
  } else {
    await logEvent(business.id, "info", "appointment_cancelled", `תור בוטל מהפאנל: ${appt.customerName}, ${fmtDateTime(appt.startAt, business.timezone)}`);
  }
  return appt;
}

export const nowIn = (business: Business) => DateTime.now().setZone(business.timezone);

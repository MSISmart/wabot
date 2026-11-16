import { DateTime } from "luxon";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Business } from "@/db/schema";
import { dayIndex } from "@/lib/time";

type Busy = { start: number; end: number };

export async function loadBusy(businessId: string, from: Date, to: Date): Promise<Busy[]> {
  const db = await getDb();
  const rows = await db.select({ s: schema.appointments.startAt, e: schema.appointments.endAt })
    .from(schema.appointments)
    .where(and(
      eq(schema.appointments.businessId, businessId),
      inArray(schema.appointments.status, ["booked", "confirmed"]),
      lte(schema.appointments.startAt, to),
      gte(schema.appointments.endAt, from),
    ));
  return rows.map((r) => ({ start: r.s.getTime(), end: r.e.getTime() }));
}

/** Free start times ("HH:mm") on a given local date. Pure: all inputs are passed in. */
export function slotsForDay(business: Business, durationMin: number, dateISO: string, busy: Busy[], now: DateTime): string[] {
  const tz = business.timezone;
  const day = DateTime.fromISO(dateISO, { zone: tz });
  if (!day.isValid) return [];
  const ranges = business.hours[String(dayIndex(day))] ?? [];
  const step = Math.max(5, business.settings.slotMinutes);
  const earliest = now.plus({ minutes: business.settings.leadMinutes }).toMillis();
  const latestDay = now.setZone(tz).startOf("day").plus({ days: business.settings.maxDaysAhead });
  if (day.startOf("day") > latestDay) return [];
  const out: string[] = [];
  for (const [from, to] of ranges) {
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm] = to.split(":").map(Number);
    let t = day.set({ hour: fh, minute: fm, second: 0, millisecond: 0 });
    const close = day.set({ hour: th, minute: tm, second: 0, millisecond: 0 });
    while (t.plus({ minutes: durationMin }) <= close) {
      const s = t.toMillis(), e = s + durationMin * 60_000;
      if (s >= earliest && !busy.some((b) => s < b.end && e > b.start)) out.push(t.toFormat("HH:mm"));
      t = t.plus({ minutes: step });
    }
  }
  return out;
}

export async function getSlots(business: Business, durationMin: number, dateISO: string, now: DateTime = DateTime.now().setZone(business.timezone)) {
  const day = DateTime.fromISO(dateISO, { zone: business.timezone });
  if (!day.isValid) return [];
  const busy = await loadBusy(business.id, day.startOf("day").toJSDate(), day.endOf("day").toJSDate());
  return slotsForDay(business, durationMin, dateISO, busy, now);
}

/** All upcoming days that still have at least one free slot. */
export async function getOpenDays(business: Business, durationMin: number, now: DateTime = DateTime.now().setZone(business.timezone)) {
  const end = now.plus({ days: business.settings.maxDaysAhead + 1 });
  const busy = await loadBusy(business.id, now.toJSDate(), end.toJSDate());
  const days: { date: string; count: number }[] = [];
  for (let i = 0; i <= business.settings.maxDaysAhead; i++) {
    const date = now.plus({ days: i }).toISODate()!;
    const count = slotsForDay(business, durationMin, date, busy, now).length;
    if (count) days.push({ date, count });
  }
  return days;
}

export function slotToDates(business: Business, dateISO: string, time: string, durationMin: number) {
  const start = DateTime.fromISO(`${dateISO}T${time}`, { zone: business.timezone });
  return { start: start.toJSDate(), end: start.plus({ minutes: durationMin }).toJSDate() };
}

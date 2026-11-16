"use server";

import bcrypt from "bcryptjs";
import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import type { Hours } from "@/db/schema";
import { getSlots, slotToDates } from "@/engine/availability";
import { cancelAppointment, nowIn, scheduleReminder } from "@/engine/bookings";
import { kapsoCreateCustomer, kapsoCreateSetupLink, kapsoRegisterWebhook } from "@/engine/kapso";
import { TEMPLATES } from "@/engine/templates";
import type { Definition, Step } from "@/engine/types";
import { createSession, destroySession, requireAdmin, requireBusiness, signToken } from "@/lib/auth";
import { appUrl } from "@/lib/defaults";
import { logEvent } from "@/lib/log";
import { addAutomationFromTemplate, createBusiness, createUser } from "@/lib/setup";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string, min: number, max: number, def: number) => {
  const n = parseInt(s(f, k), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const back = (path: string, kind: "ok" | "error", msg: string): never => redirect(`${path}?${kind}=${encodeURIComponent(msg)}`);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- auth ----------
export async function loginAction(f: FormData) {
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, s(f, "email").toLowerCase())).limit(1);
  if (!u || !(await bcrypt.compare(s(f, "password"), u.passwordHash))) back("/login", "error", "אימייל או סיסמה לא נכונים");
  await createSession(u.id);
  redirect("/");
}
export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
/** First run only: creates the admin user. Refuses once any user exists. */
export async function setupAction(f: FormData) {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  if (n > 0) redirect("/login");
  const email = s(f, "email"), password = s(f, "password");
  if (!/^\S+@\S+\.\S+$/.test(email)) back("/setup", "error", "כתובת אימייל לא תקינה");
  if (password.length < 8) back("/setup", "error", "הסיסמה צריכה לפחות 8 תווים");
  const u = await createUser({ email, password, name: s(f, "name"), role: "admin" });
  if (s(f, "demo")) {
    await createBusiness({
      name: "מספרת הדגמה", address: "הרצל 10, תל אביב",
      services: [{ name: "תספורת", durationMin: 30, price: 80 }, { name: "תספורת + זקן", durationMin: 45, price: 110 }, { name: "צבע", durationMin: 90, price: 250 }],
    });
  }
  await createSession(u.id);
  redirect("/");
}

// ---------- admin ----------
export async function createBusinessAction(f: FormData) {
  await requireAdmin();
  const name = s(f, "name");
  if (!name) back("/admin", "error", "חסר שם לעסק");
  const b = await createBusiness({ name, address: s(f, "address"), ownerPhone: s(f, "ownerPhone").replace(/\D/g, "") });
  await logEvent(b.id, "info", "business_created", `העסק "${name}" נוצר`);
  redirect(`/b/${b.id}/settings?ok=${encodeURIComponent("העסק נוצר. כדאי לעדכן שירותים ושעות פעילות")}`);
}
export async function deleteBusinessAction(bid: string, f: FormData) {
  await requireAdmin();
  const { business } = await requireBusiness(bid);
  if (s(f, "confirm") !== business.name) back(`/b/${bid}/settings`, "error", "כדי למחוק צריך להקליד את שם העסק במדויק");
  const db = await getDb();
  await db.delete(schema.businesses).where(eq(schema.businesses.id, bid));
  back("/admin", "ok", `העסק "${business.name}" נמחק`);
}
export async function createOwnerUserAction(bid: string, f: FormData) {
  await requireAdmin();
  await requireBusiness(bid);
  const email = s(f, "email"), password = s(f, "password"), path = `/b/${bid}/settings`;
  if (!/^\S+@\S+\.\S+$/.test(email)) back(path, "error", "כתובת אימייל לא תקינה");
  if (password.length < 8) back(path, "error", "הסיסמה צריכה לפחות 8 תווים");
  try { await createUser({ email, password, name: s(f, "name"), role: "owner", businessId: bid }); }
  catch { back(path, "error", "כבר קיים משתמש עם האימייל הזה"); }
  back(path, "ok", "המשתמש נוצר. אפשר לשלוח לבעל העסק את פרטי הכניסה");
}
export async function deleteUserAction(bid: string, userId: string) {
  await requireAdmin();
  const db = await getDb();
  await db.delete(schema.users).where(and(eq(schema.users.id, userId), eq(schema.users.businessId, bid), eq(schema.users.role, "owner")));
  back(`/b/${bid}/settings`, "ok", "המשתמש הוסר");
}

// ---------- business settings ----------
export async function toggleBotAction(bid: string) {
  const { business } = await requireBusiness(bid);
  const db = await getDb();
  await db.update(schema.businesses).set({ botEnabled: !business.botEnabled }).where(eq(schema.businesses.id, bid));
  await logEvent(bid, "info", "bot_toggled", business.botEnabled ? "הבוט כובה" : "הבוט הופעל");
  revalidatePath(`/b/${bid}`, "layout");
}
export async function saveBusinessAction(bid: string, f: FormData) {
  await requireBusiness(bid);
  const name = s(f, "name");
  if (!name) back(`/b/${bid}/settings`, "error", "חסר שם לעסק");
  const db = await getDb();
  await db.update(schema.businesses).set({
    name, address: s(f, "address"), about: s(f, "about").slice(0, 2000), ownerPhone: s(f, "ownerPhone").replace(/\D/g, ""),
  }).where(eq(schema.businesses.id, bid));
  back(`/b/${bid}/settings`, "ok", "פרטי העסק נשמרו");
}
export async function saveHoursAction(bid: string, f: FormData) {
  await requireBusiness(bid);
  const hours: Hours = {};
  const ok = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  for (let d = 0; d < 7; d++) {
    hours[d] = [];
    if (!f.get(`open:${d}`)) continue;
    for (const part of ["a", "b"]) {
      const from = s(f, `from:${d}:${part}`), to = s(f, `to:${d}:${part}`);
      if (!from && !to) continue;
      if (!ok(from) || !ok(to) || from >= to) back(`/b/${bid}/settings`, "error", "שעות לא תקינות: שעת הסיום צריכה להיות אחרי שעת ההתחלה");
      hours[d].push([from, to]);
    }
    hours[d].sort((x, y) => x[0].localeCompare(y[0]));
    if (hours[d].length === 2 && hours[d][0][1] > hours[d][1][0]) back(`/b/${bid}/settings`, "error", "שני טווחי השעות באותו יום חופפים");
  }
  const db = await getDb();
  await db.update(schema.businesses).set({ hours }).where(eq(schema.businesses.id, bid));
  back(`/b/${bid}/settings`, "ok", "שעות הפעילות נשמרו");
}
export async function saveBookingSettingsAction(bid: string, f: FormData) {
  const { business } = await requireBusiness(bid);
  const db = await getDb();
  await db.update(schema.businesses).set({
    settings: {
      ...business.settings,
      slotMinutes: num(f, "slotMinutes", 5, 240, 30),
      leadMinutes: num(f, "leadMinutes", 0, 10080, 60),
      maxDaysAhead: num(f, "maxDaysAhead", 1, 90, 14),
      reminderHours: num(f, "reminderHours", 1, 168, 24),
      reminderTemplate: s(f, "reminderTemplate") || undefined,
      reminderTemplateLang: s(f, "reminderTemplateLang") || "he",
      aiEnabled: !!f.get("aiEnabled"),
    },
  }).where(eq(schema.businesses.id, bid));
  back(`/b/${bid}/settings`, "ok", "הגדרות התורים נשמרו");
}

// ---------- services ----------
export async function addServiceAction(bid: string, f: FormData) {
  await requireBusiness(bid);
  const name = s(f, "name");
  if (!name) back(`/b/${bid}/settings`, "error", "חסר שם לשירות");
  const db = await getDb();
  const price = s(f, "price");
  await db.insert(schema.services).values({
    businessId: bid, name: name.slice(0, 60), durationMin: num(f, "durationMin", 5, 600, 30),
    price: price ? num(f, "price", 0, 100000, 0) : null, sort: Date.now() % 1_000_000_000,
  });
  back(`/b/${bid}/settings`, "ok", "השירות נוסף");
}
export async function updateServiceAction(bid: string, sid: string, f: FormData) {
  await requireBusiness(bid);
  const db = await getDb();
  const where = and(eq(schema.services.id, sid), eq(schema.services.businessId, bid));
  if (f.get("intent") === "delete") {
    await db.delete(schema.services).where(where);
    back(`/b/${bid}/settings`, "ok", "השירות נמחק");
  }
  const price = s(f, "price");
  await db.update(schema.services).set({
    name: s(f, "name").slice(0, 60) || "שירות", durationMin: num(f, "durationMin", 5, 600, 30),
    price: price ? num(f, "price", 0, 100000, 0) : null, active: !!f.get("active"),
  }).where(where);
  back(`/b/${bid}/settings`, "ok", "השירות עודכן");
}

// ---------- automations ----------
export async function toggleAutomationAction(bid: string, aid: string) {
  await requireBusiness(bid);
  const db = await getDb();
  const where = and(eq(schema.automations.id, aid), eq(schema.automations.businessId, bid));
  const [a] = await db.select().from(schema.automations).where(where).limit(1);
  if (a) await db.update(schema.automations).set({ enabled: !a.enabled }).where(where);
  revalidatePath(`/b/${bid}/automations`);
}
export async function addAutomationAction(bid: string, key: string) {
  await requireBusiness(bid);
  if (!TEMPLATES.some((t) => t.key === key)) back(`/b/${bid}/automations`, "error", "תבנית לא קיימת");
  const db = await getDb();
  const existing = await db.select().from(schema.automations).where(eq(schema.automations.businessId, bid));
  const a = await addAutomationFromTemplate(bid, key);
  // Only one automation can be the default (answers every message); extra copies start switched off.
  if (a.trigger.type === "default" && existing.some((x) => x.trigger.type === "default")) {
    await db.update(schema.automations).set({ enabled: false }).where(eq(schema.automations.id, a.id));
  }
  redirect(`/b/${bid}/automations/${a.id}?ok=${encodeURIComponent("האוטומציה נוספה מהתבנית. אפשר לערוך את הטקסטים")}`);
}
export async function deleteAutomationAction(bid: string, aid: string) {
  await requireBusiness(bid);
  const db = await getDb();
  await db.delete(schema.automations).where(and(eq(schema.automations.id, aid), eq(schema.automations.businessId, bid)));
  back(`/b/${bid}/automations`, "ok", "האוטומציה נמחקה");
}
export async function saveAutomationAction(bid: string, aid: string, f: FormData) {
  await requireBusiness(bid);
  const db = await getDb();
  const where = and(eq(schema.automations.id, aid), eq(schema.automations.businessId, bid));
  const [a] = await db.select().from(schema.automations).where(where).limit(1);
  if (!a) back(`/b/${bid}/automations`, "error", "האוטומציה לא נמצאה");
  const def: Definition = structuredClone(a.definition);
  for (const step of def.steps as (Step & Record<string, unknown>)[]) {
    for (const field of ["text", "noSlotsText", "cancelText", "successText", "takenText", "emptyText", "cancelledText", "buttonLabel"]) {
      const v = f.get(`f:${step.id}:${field}`);
      if (typeof v === "string" && field in step) {
        if (!v.trim() && field !== "buttonLabel") back(`/b/${bid}/automations/${aid}`, "error", "אי אפשר להשאיר הודעה ריקה");
        step[field] = v.replace(/\r\n/g, "\n").trim().slice(0, 1000);
      }
    }
    if (step.type === "menu") {
      for (const o of step.options) {
        const label = f.get(`o:${step.id}:${o.id}:label`), desc = f.get(`o:${step.id}:${o.id}:description`);
        if (typeof label === "string" && label.trim()) o.label = label.trim().slice(0, 24);
        if (typeof desc === "string") o.description = desc.trim().slice(0, 72) || undefined;
      }
    }
  }
  const keywords = s(f, "keywords").split(/[,\n]/).map((k) => k.trim()).filter(Boolean).slice(0, 30);
  const trigger = a.trigger.type === "keywords" ? { type: "keywords" as const, keywords } : a.trigger;
  if (trigger.type === "keywords" && !keywords.length) back(`/b/${bid}/automations/${aid}`, "error", "צריך לפחות מילת מפתח אחת");
  await db.update(schema.automations).set({ name: s(f, "name").slice(0, 60) || a.name, definition: def, trigger }).where(where);
  back(`/b/${bid}/automations/${aid}`, "ok", "השינויים נשמרו");
}

// ---------- appointments ----------
export async function cancelAppointmentAction(bid: string, apptId: string) {
  const { business } = await requireBusiness(bid);
  await cancelAppointment(business, apptId, "business");
  back(`/b/${bid}/appointments`, "ok", "התור בוטל. הלקוח לא מקבל על כך הודעה אוטומטית");
}
export async function addAppointmentAction(bid: string, f: FormData) {
  const { business } = await requireBusiness(bid);
  const path = `/b/${bid}/appointments`;
  const db = await getDb();
  const [svc] = await db.select().from(schema.services)
    .where(and(eq(schema.services.id, isUuid(s(f, "serviceId")) ? s(f, "serviceId") : "00000000-0000-0000-0000-000000000000"), eq(schema.services.businessId, bid))).limit(1);
  const date = s(f, "date"), time = s(f, "time"), name = s(f, "name");
  if (!svc || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !name) back(path, "error", "חסרים פרטים: שם, שירות, תאריך ושעה");
  const { start, end } = slotToDates(business, date, time, svc.durationMin);
  if (start < new Date()) back(path, "error", "אי אפשר לקבוע תור בעבר");
  // Manual bookings may ignore opening hours, but never overlap an existing appointment.
  const free = await getSlots({ ...business, hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [["00:00", "23:59"]]])), settings: { ...business.settings, slotMinutes: 5, leadMinutes: 0, maxDaysAhead: 365 } }, svc.durationMin, date, nowIn(business));
  if (!free.includes(time) && !f.get("force")) back(path, "error", "השעה הזאת מתנגשת עם תור קיים");
  const phone = s(f, "phone").replace(/\D/g, "");
  const [appt] = await db.insert(schema.appointments).values({
    businessId: bid, customerName: name, customerPhone: phone, serviceId: svc.id, serviceName: svc.name,
    startAt: start, endAt: end, source: "manual", notes: s(f, "notes").slice(0, 500),
  }).returning();
  // A reminder needs a WhatsApp contact; link one if this phone already wrote to the business.
  if (phone) {
    const [c] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.businessId, bid), eq(schema.contacts.waId, phone))).limit(1);
    if (c) {
      await db.update(schema.appointments).set({ contactId: c.id }).where(eq(schema.appointments.id, appt.id));
      await scheduleReminder(business, appt);
    }
  }
  back(path, "ok", "התור נוסף");
}

// ---------- inbox ----------
export async function setBotPausedAction(bid: string, cid: string, paused: boolean) {
  await requireBusiness(bid);
  const db = await getDb();
  await db.update(schema.conversations).set({ botPaused: paused, needsHuman: false, state: null })
    .where(and(eq(schema.conversations.id, cid), eq(schema.conversations.businessId, bid)));
  revalidatePath(`/b/${bid}/inbox`);
}

// ---------- WhatsApp connection (admin) ----------
export async function createSetupLinkAction(bid: string) {
  await requireAdmin();
  const { business } = await requireBusiness(bid);
  const path = `/b/${bid}/settings`;
  let url = "";
  try {
    const db = await getDb();
    const customerId = business.kapsoCustomerId ?? (await kapsoCreateCustomer(business.name, business.id));
    const token = await signToken({ connectBusiness: bid }, "30d");
    url = await kapsoCreateSetupLink(customerId, `${appUrl()}/api/kapso/connected/${token}`, `${appUrl()}/connected?ok=0`);
    await db.update(schema.businesses).set({ kapsoCustomerId: customerId, setupLinkUrl: url }).where(eq(schema.businesses.id, bid));
  } catch (e) {
    await logEvent(bid, "error", "setup_link_failed", "יצירת לינק חיבור נכשלה", { error: errText(e) });
    back(path, "error", `יצירת הלינק נכשלה: ${errText(e).slice(0, 160)}`);
  }
  back(path, "ok", "לינק החיבור מוכן. שולחים אותו לבעל העסק");
}
export async function savePhoneNumberAction(bid: string, f: FormData) {
  await requireAdmin();
  await requireBusiness(bid);
  const path = `/b/${bid}/settings`;
  const phoneNumberId = s(f, "phoneNumberId").replace(/\D/g, "") || null;
  const db = await getDb();
  if (phoneNumberId) {
    const [taken] = await db.select().from(schema.businesses).where(eq(schema.businesses.phoneNumberId, phoneNumberId)).limit(1);
    if (taken && taken.id !== bid) back(path, "error", `המספר הזה כבר מחובר לעסק "${taken.name}"`);
  }
  await db.update(schema.businesses).set({ phoneNumberId, displayPhone: s(f, "displayPhone") || null }).where(eq(schema.businesses.id, bid));
  back(path, "ok", phoneNumberId ? "המספר נשמר. עכשיו צריך לרשום webhook" : "המספר נותק מהעסק");
}
export async function registerWebhookAction(bid: string) {
  await requireAdmin();
  const { business } = await requireBusiness(bid);
  const path = `/b/${bid}/settings`;
  if (!business.phoneNumberId) back(path, "error", "קודם צריך לחבר מספר");
  if (!process.env.KAPSO_WEBHOOK_SECRET) back(path, "error", "KAPSO_WEBHOOK_SECRET לא מוגדר במשתני הסביבה");
  try {
    await kapsoRegisterWebhook(business.phoneNumberId!, `${appUrl()}/api/webhooks/kapso`, process.env.KAPSO_WEBHOOK_SECRET!);
  } catch (e) {
    back(path, "error", `רישום ה-webhook נכשל: ${errText(e).slice(0, 160)}`);
  }
  await logEvent(bid, "info", "webhook_registered", "ה-webhook נרשם ב-Kapso");
  back(path, "ok", "ה-webhook נרשם. הודעות נכנסות יגיעו עכשיו לבוט");
}

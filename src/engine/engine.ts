import { DateTime } from "luxon";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Automation, Business, Contact, Conversation, Service } from "@/db/schema";
import { hoursText } from "@/lib/defaults";
import { logEvent } from "@/lib/log";
import { fmtDay, fmtTime, isoDate, parseDay, parseTime, relativeDayLabel } from "@/lib/time";
import { aiAvailable, aiInterpret } from "./ai";
import { getOpenDays, getSlots, slotToDates } from "./availability";
import { cancelAppointment, notifyOwner, scheduleReminder } from "./bookings";
import { deliver } from "./deliver";
import type { ConvState, Inbound, OutMsg, Step, StepType } from "./types";

const SESSION_MS = 2 * 3600_000;
const RESET_WORDS = ["תפריט", "התחל", "התחלה", "menu", "start", "0"];
const HUMAN_RE = /נציג|בן אדם|אנושי/;
const norm = (s: string) => s.trim().toLowerCase().replace(/[!?.,"'״׳]/g, "");

type EnterResult = { wait: true } | { next?: string };
type InputResult = { next?: string } | { retry: true; hint?: string } | { reenter: true } | { goto: string };

export class Run {
  state: ConvState;
  services: Service[] = [];
  automations: Automation[] = [];
  automation!: Automation;

  constructor(
    public business: Business, public contact: Contact, public conversation: Conversation, public now: DateTime,
  ) {
    const s = conversation.state;
    this.state = s && this.now.toMillis() - s.at < SESSION_MS ? s : null;
  }

  // ---------- helpers ----------
  get vars() { return this.state!.vars; }
  send(out: OutMsg) { return deliver(this.business, this.conversation, this.contact, out, "bot"); }
  text(t: string) { return this.send({ type: "text", text: this.render(t) }); }
  step(id?: string) { return this.automation.definition.steps.find((s) => s.id === id); }
  firstOf(type: StepType) { return this.automation.definition.steps.find((s) => s.type === type)?.id; }
  service() { return this.services.find((s) => s.id === this.state?.vars.serviceId); }

  render(t: string) {
    const v = this.state?.vars ?? {};
    const tz = this.business.timezone;
    const map: Record<string, string> = {
      ...v,
      business: this.business.name,
      address: this.business.address || "—",
      hours: hoursText(this.business.hours),
      service: this.service()?.name ?? "",
      date: v.date ? fmtDay(v.date, tz) : "",
      time: v.time ?? "",
      name: v.name ?? this.contact.name ?? "",
      phone: this.contact.waId,
    };
    return t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => map[k] ?? "");
  }

  async save() {
    const db = await getDb();
    if (this.state) this.state.at = this.now.toMillis();
    await db.update(schema.conversations).set({ state: this.state }).where(eq(schema.conversations.id, this.conversation.id));
  }

  async load() {
    const db = await getDb();
    this.services = await db.select().from(schema.services)
      .where(and(eq(schema.services.businessId, this.business.id), eq(schema.services.active, true)))
      .orderBy(asc(schema.services.sort), asc(schema.services.name));
    this.automations = await db.select().from(schema.automations)
      .where(and(eq(schema.automations.businessId, this.business.id), eq(schema.automations.enabled, true)))
      .orderBy(asc(schema.automations.createdAt));
  }

  // ---------- entry point ----------
  async handle(inb: Inbound) {
    await this.load();
    if (inb.replyId?.startsWith("appt:")) return this.reminderReply(inb.replyId);

    const t = norm(inb.text);
    if (inb.kind === "text" && RESET_WORDS.includes(t)) this.state = null;
    if (inb.kind === "text" && HUMAN_RE.test(t)) return this.handoff("העברתי את השיחה לנציג, נחזור אליך בהקדם 🙏");

    if (this.state) {
      const a = this.automations.find((x) => x.id === this.state!.automationId);
      const step = a?.definition.steps.find((s) => s.id === this.state!.stepId);
      if (a && step && this.state.awaiting) {
        this.automation = a;
        return this.resolve(step, await this.input(step, inb), inb);
      }
      this.state = null;
    }
    return this.start(inb);
  }

  async start(inb: Inbound) {
    const t = norm(inb.text);
    const byKeyword = inb.kind === "text"
      ? this.automations.find((a) => a.trigger.type === "keywords" && a.trigger.keywords.some((k) => k && t.includes(norm(k))))
      : undefined;
    const a = byKeyword ?? this.automations.find((x) => x.trigger.type === "default");
    if (!a) {
      await logEvent(this.business.id, "warn", "no_automation", "התקבלה הודעה אבל אין אוטומציה פעילה שמטפלת בה");
      return;
    }
    this.automation = a;
    this.state = { automationId: a.id, stepId: a.definition.start, vars: { phone: this.contact.waId }, awaiting: false, retries: 0, at: 0 };
    if (this.contact.name) this.state.vars.name = this.contact.name;
    // A full sentence as the opening message ("אפשר תור מחר ב-10?") is worth understanding before showing a menu.
    if (!byKeyword && inb.kind === "text" && inb.text.trim().split(/\s+/).length >= 3 && (await this.tryAI(inb.text))) return;
    return this.runFrom(a.definition.start);
  }

  async runFrom(stepId?: string) {
    let id = stepId;
    for (let guard = 0; id && guard < 25; guard++) {
      const step = this.step(id);
      if (!step || !this.state) break;
      const r = await this.enter(step);
      if (!this.state) return this.save(); // a step ended the session (handoff)
      if ("wait" in r) {
        this.state.stepId = step.id;
        this.state.awaiting = true;
        return this.save();
      }
      id = r.next;
    }
    this.state = null;
    return this.save();
  }

  async resolve(step: Step, r: InputResult, inb: Inbound): Promise<void> {
    if (!this.state) return this.save();
    if ("goto" in r) { this.state.retries = 0; return this.runFrom(r.goto); }
    if ("reenter" in r) return this.runFrom(step.id);
    if ("retry" in r) {
      if (inb.kind === "text" && (await this.tryAI(inb.text))) return;
      this.state.retries++;
      const tail = this.state.retries >= 2 ? "\nאפשר גם לכתוב \"תפריט\" להתחלה מחדש או \"נציג\" לשיחה עם נציג." : "";
      await this.text((r.hint ?? "לא הצלחתי להבין 🙈 אפשר לבחור מהאפשרויות:") + tail);
      return this.runFrom(step.id);
    }
    this.state.retries = 0;
    return this.runFrom(r.next);
  }

  // ---------- AI (understanding only) ----------
  async tryAI(text: string): Promise<boolean> {
    if (!aiAvailable(this.business) || !this.state) return false;
    const r = await aiInterpret(this.business, this.services, text, this.now);
    if (!r) return false;
    if (r.intent === "human") { await this.handoff("העברתי את השיחה לנציג, נחזור אליך בהקדם 🙏"); return true; }
    if (r.intent === "question" && r.answer) {
      await this.text(r.answer);
      await this.runFrom(this.state.awaiting ? this.state.stepId : this.automation.definition.start);
      return true;
    }
    const target = r.intent === "book" ? "pick_service" : r.intent === "cancel" ? "my_appointments" : null;
    if (!target) return false;
    const a = this.automation.definition.steps.some((s) => s.type === target)
      ? this.automation : this.automations.find((x) => x.definition.steps.some((s) => s.type === target));
    if (!a) return false;
    if (a.id !== this.automation.id) { this.automation = a; this.state.automationId = a.id; }
    if (r.intent === "book") {
      // Only hints. Each picker re-checks them against the real services and free slots.
      if (r.serviceId && this.services.some((s) => s.id === r.serviceId)) this.vars.serviceId = r.serviceId;
      if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) this.vars.date = r.date;
      if (r.time && /^\d{2}:\d{2}$/.test(r.time)) this.vars.time = r.time;
    }
    this.state.retries = 0;
    await this.runFrom(this.firstOf(target));
    return true;
  }

  async handoff(text: string) {
    const db = await getDb();
    await this.text(text);
    await db.update(schema.conversations).set({ botPaused: true, needsHuman: true, state: null })
      .where(eq(schema.conversations.id, this.conversation.id));
    this.state = null;
    await notifyOwner(this.business, `לקוח מבקש נציג 🙋\n${this.contact.name || "ללא שם"} (${this.contact.waId})`);
  }

  // ---------- steps: what the bot sends ----------
  async enter(step: Step): Promise<EnterResult> {
    const tz = this.business.timezone;
    switch (step.type) {
      case "message":
        await this.text(step.text);
        return { next: step.next };

      case "menu": {
        const text = this.render(step.text);
        if (step.options.length <= 3 && step.options.every((o) => o.label.length <= 20)) {
          await this.send({ type: "buttons", text, buttons: step.options.map((o) => ({ id: o.id, title: o.label })) });
        } else {
          await this.send({
            type: "list", text, button: step.buttonLabel || "לבחירה",
            rows: step.options.map((o) => ({ id: o.id, title: o.label, description: o.description })),
          });
        }
        return { wait: true };
      }

      case "ask":
        await this.text(step.text);
        return { wait: true };

      case "pick_service": {
        if (!this.services.length) {
          await this.text("עדיין לא הוגדרו שירותים לקביעת תור. אפשר לכתוב \"נציג\" ונחזור אליך.");
          return {};
        }
        if (this.service()) return { next: step.next };
        if (this.services.length === 1) { this.vars.serviceId = this.services[0].id; return { next: step.next }; }
        await this.send({
          type: "list", text: this.render(step.text), button: "שירותים",
          rows: this.services.slice(0, 10).map((s) => ({
            id: `svc:${s.id}`, title: s.name,
            description: `${s.durationMin} דק׳${s.price != null ? ` · ${s.price} ₪` : ""}`,
          })),
        });
        return { wait: true };
      }

      case "pick_day": {
        const svc = this.service();
        if (!svc) return { next: this.firstOf("pick_service") };
        const days = await getOpenDays(this.business, svc.durationMin, this.now);
        if (this.vars.date) {
          if (days.some((d) => d.date === this.vars.date)) return { next: step.next };
          await this.text(`אין תורים פנויים ב${fmtDay(this.vars.date, tz)}.`);
          delete this.vars.date; delete this.vars.time;
        }
        if (!days.length) { await this.text(step.noSlotsText); return {}; }
        const page = Math.min(+(this.vars._dayPage ?? 0), Math.floor((days.length - 1) / 9));
        const slice = days.slice(page * 9, page * 9 + 9);
        const rows = slice.map((d) => ({
          id: `day:${d.date}`, title: fmtDay(d.date, tz, true),
          description: [relativeDayLabel(d.date, this.now), `${d.count} שעות פנויות`].filter(Boolean).join(" · "),
        }));
        if (days.length > page * 9 + 9) rows.push({ id: "day:more", title: "תאריכים נוספים", description: "" });
        else if (page > 0) rows.push({ id: "day:first", title: "חזרה לתאריכים הקרובים", description: "" });
        await this.send({ type: "list", text: this.render(step.text), button: "ימים פנויים", rows });
        return { wait: true };
      }

      case "pick_time": {
        const svc = this.service();
        if (!svc || !this.vars.date) return { next: this.firstOf(svc ? "pick_day" : "pick_service") };
        const slots = await getSlots(this.business, svc.durationMin, this.vars.date, this.now);
        if (this.vars.time) {
          if (slots.includes(this.vars.time)) return { next: step.next };
          await this.text(`השעה ${this.vars.time} לא פנויה ב${fmtDay(this.vars.date, tz)}.`);
          delete this.vars.time;
        }
        if (!slots.length) {
          await this.text(`אין שעות פנויות ב${fmtDay(this.vars.date, tz)}.`);
          delete this.vars.date;
          return { next: this.firstOf("pick_day") };
        }
        const page = Math.min(+(this.vars._timePage ?? 0), Math.floor((slots.length - 1) / 8));
        const rows = slots.slice(page * 8, page * 8 + 8).map((s) => ({ id: `time:${s}`, title: s, description: "" }));
        if (slots.length > page * 8 + 8) rows.push({ id: "time:more", title: "שעות מאוחרות יותר", description: "" });
        else if (page > 0) rows.push({ id: "time:first", title: "חזרה לשעות הראשונות", description: "" });
        rows.push({ id: "time:back", title: "יום אחר", description: "" });
        await this.send({ type: "list", text: this.render(step.text), button: "שעות פנויות", rows });
        return { wait: true };
      }

      case "confirm_booking":
        await this.send({
          type: "buttons", text: this.render(step.text),
          buttons: [{ id: "ok:yes", title: "אישור ✅" }, { id: "ok:change", title: "שינוי מועד" }, { id: "ok:cancel", title: "ביטול" }],
        });
        return { wait: true };

      case "create_booking": {
        const svc = this.service();
        const { date, time } = this.vars;
        if (!svc || !date || !time) return { next: this.firstOf("pick_service") };
        const slots = await getSlots(this.business, svc.durationMin, date, this.now);
        if (!slots.includes(time)) {
          await this.text(step.takenText);
          delete this.vars.time;
          return { next: this.firstOf("pick_time") };
        }
        const db = await getDb();
        const { start, end } = slotToDates(this.business, date, time, svc.durationMin);
        const customerName = this.vars.name || this.contact.name || "";
        const [appt] = await db.insert(schema.appointments).values({
          businessId: this.business.id, contactId: this.contact.id, customerName, customerPhone: this.contact.waId,
          serviceId: svc.id, serviceName: svc.name, startAt: start, endAt: end, source: "bot",
        }).returning();
        await scheduleReminder(this.business, appt, this.now.toJSDate());
        await this.text(step.successText);
        await notifyOwner(this.business, `תור חדש 📅\n${customerName} (${this.contact.waId})\n${svc.name}, ${fmtDay(date, tz)} בשעה ${time}`);
        for (const k of ["serviceId", "date", "time", "_dayPage", "_timePage"]) delete this.vars[k];
        return { next: step.next };
      }

      case "my_appointments": {
        const list = await this.upcoming();
        if (!list.length) { await this.text(step.emptyText); return { next: step.next }; }
        const rows = list.map((a) => ({
          id: `cancel:${a.id}`, title: `${fmtDay(isoDate(a.startAt, tz), tz, true)} ${fmtTime(a.startAt, tz)}`,
          description: `ביטול התור: ${a.serviceName}`,
        }));
        rows.push({ id: "keep", title: "לא לבטל כלום", description: "" });
        await this.send({ type: "list", text: this.render(step.text), button: "התורים שלי", rows });
        return { wait: true };
      }

      case "notify_owner":
        await notifyOwner(this.business, this.render(step.text));
        return { next: step.next };

      case "handoff":
        await this.handoff(this.render(step.text));
        return {};
    }
  }

  // ---------- steps: what the customer answered ----------
  async input(step: Step, inb: Inbound): Promise<InputResult> {
    const t = norm(inb.text);
    const id = inb.replyId ?? "";
    const tz = this.business.timezone;
    switch (step.type) {
      case "menu": {
        const n = /^\d{1,2}$/.test(t) ? +t - 1 : -1;
        const o = step.options.find((x) => x.id === id) ?? step.options[n]
          ?? (t ? step.options.find((x) => norm(x.label) === t || (t.length >= 3 && norm(x.label).includes(t))) : undefined);
        return o ? { next: o.next } : { retry: true };
      }

      case "ask": {
        const v = inb.text.trim();
        if (inb.kind !== "text" || !v) return { retry: true, hint: "אשמח לתשובה בהודעת טקסט 🙂" };
        if (step.validate === "name" && (v.length < 2 || v.length > 40 || /\d{3,}/.test(v))) return { retry: true, hint: "לא הצלחתי לקלוט את השם." };
        if (step.validate === "phone" && !/^[\d\s+-]{9,16}$/.test(v)) return { retry: true, hint: "זה לא נראה כמו מספר טלפון." };
        this.vars[step.saveAs] = v.slice(0, 500);
        if (step.saveAs === "name") {
          const db = await getDb();
          await db.update(schema.contacts).set({ name: v }).where(eq(schema.contacts.id, this.contact.id));
          this.contact.name = v;
        }
        return { next: step.next };
      }

      case "pick_service": {
        const n = /^\d{1,2}$/.test(t) ? +t - 1 : -1;
        const s = this.services.find((x) => `svc:${x.id}` === id) ?? this.services[n]
          ?? (t.length >= 2 ? this.services.find((x) => norm(x.name) === t || norm(x.name).includes(t)) : undefined);
        if (!s) return { retry: true };
        this.vars.serviceId = s.id;
        return { next: step.next };
      }

      case "pick_day": {
        if (id === "day:more") { this.vars._dayPage = String(+(this.vars._dayPage ?? 0) + 1); return { reenter: true }; }
        if (id === "day:first") { delete this.vars._dayPage; return { reenter: true }; }
        const date = id.startsWith("day:") ? id.slice(4) : inb.kind === "text" ? parseDay(inb.text, this.now) : null;
        if (!date) return { retry: true, hint: "לא הצלחתי להבין את התאריך. אפשר לבחור מהרשימה:" };
        const svc = this.service();
        const slots = svc ? await getSlots(this.business, svc.durationMin, date, this.now) : [];
        if (!slots.length) return { retry: true, hint: `אין תורים פנויים ב${fmtDay(date, tz)}. אלה הימים הפנויים:` };
        this.vars.date = date;
        delete this.vars._timePage;
        const time = inb.kind === "text" && /\d/.test(inb.text.replace(/\d{1,2}[./-]\d{1,2}/, "")) ? parseTime(inb.text.replace(/\d{1,2}[./-]\d{1,2}/, "")) : null;
        if (time && slots.includes(time)) this.vars.time = time;
        return { next: step.next };
      }

      case "pick_time": {
        if (id === "time:more") { this.vars._timePage = String(+(this.vars._timePage ?? 0) + 1); return { reenter: true }; }
        if (id === "time:first") { delete this.vars._timePage; return { reenter: true }; }
        if (id === "time:back") { delete this.vars.date; delete this.vars._timePage; return { goto: this.firstOf("pick_day")! }; }
        const time = id.startsWith("time:") ? id.slice(5) : inb.kind === "text" ? parseTime(inb.text) : null;
        if (!time) return { retry: true, hint: "לא הצלחתי להבין את השעה. אפשר לבחור מהרשימה:" };
        const svc = this.service();
        const slots = svc && this.vars.date ? await getSlots(this.business, svc.durationMin, this.vars.date, this.now) : [];
        if (!slots.includes(time)) return { retry: true, hint: `השעה ${time} לא פנויה. אלה השעות הפנויות:` };
        this.vars.time = time;
        return { next: step.next };
      }

      case "confirm_booking": {
        if (id === "ok:yes" || /^(כן|אישור|מאשר|מאשרת|לקבוע|סבבה|יאללה)/.test(t)) return { next: step.next };
        if (id === "ok:change" || /שינוי|לשנות/.test(t)) {
          for (const k of ["date", "time", "_dayPage", "_timePage"]) delete this.vars[k];
          return { goto: this.firstOf("pick_day")! };
        }
        if (id === "ok:cancel" || /^(לא|ביטול|בטל)/.test(t)) {
          await this.text(step.cancelText);
          this.state = null;
          return {};
        }
        return { retry: true };
      }

      case "my_appointments": {
        if (id === "keep" || /^(לא|השאר)/.test(t)) { await this.text("מעולה, התורים נשארים כמו שהם 👍"); return { next: step.next }; }
        const list = await this.upcoming();
        const n = /^\d{1,2}$/.test(t) ? +t - 1 : -1;
        const a = list.find((x) => `cancel:${x.id}` === id) ?? list[n];
        if (!a) return { retry: true };
        await cancelAppointment(this.business, a.id, "customer");
        await this.text(step.cancelledText);
        return { next: step.next };
      }

      default:
        return { next: (step as { next?: string }).next };
    }
  }

  async upcoming() {
    const db = await getDb();
    return db.select().from(schema.appointments)
      .where(and(
        eq(schema.appointments.businessId, this.business.id), eq(schema.appointments.contactId, this.contact.id),
        inArray(schema.appointments.status, ["booked", "confirmed"]), gt(schema.appointments.startAt, this.now.toJSDate()),
      ))
      .orderBy(asc(schema.appointments.startAt)).limit(9);
  }

  /** Buttons on the reminder message: appt:ok:<id> / appt:no:<id>. Work at any point in the conversation. */
  async reminderReply(replyId: string) {
    const [, action, apptId] = replyId.split(":");
    const db = await getDb();
    const [appt] = await db.select().from(schema.appointments)
      .where(and(eq(schema.appointments.id, apptId), eq(schema.appointments.contactId, this.contact.id))).limit(1);
    if (!appt || appt.status === "cancelled" || appt.startAt < this.now.toJSDate()) {
      await this.text("התור הזה כבר לא פעיל. לקביעת תור חדש אפשר לכתוב \"תפריט\".");
      return;
    }
    if (action === "ok") {
      await db.update(schema.appointments).set({ status: "confirmed" }).where(eq(schema.appointments.id, appt.id));
      await this.text("תודה, רשמתי שאת/ה מגיע/ה. נתראה! 🙌");
    } else {
      await cancelAppointment(this.business, appt.id, "customer");
      await this.text("התור בוטל. לקביעת תור חדש אפשר לכתוב \"תפריט\".");
    }
  }
}

/** Everything that arrives from WhatsApp (or the simulator) enters here. */
export async function processInbound(
  businessId: string, waId: string, profileName: string, inb: Inbound, now?: DateTime,
) {
  const db = await getDb();
  const [business] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).limit(1);
  if (!business) return;

  await db.insert(schema.contacts).values({ businessId, waId, name: profileName }).onConflictDoNothing();
  const [contact] = await db.select().from(schema.contacts)
    .where(and(eq(schema.contacts.businessId, businessId), eq(schema.contacts.waId, waId))).limit(1);
  await db.insert(schema.conversations).values({ businessId, contactId: contact.id }).onConflictDoNothing();
  const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.contactId, contact.id)).limit(1);

  if (inb.waMessageId) {
    const [dup] = await db.select({ id: schema.messages.id }).from(schema.messages)
      .where(and(eq(schema.messages.waMessageId, inb.waMessageId), eq(schema.messages.conversationId, conversation.id))).limit(1);
    if (dup) return;
  }
  const at = new Date();
  await db.insert(schema.messages).values({
    businessId, conversationId: conversation.id, direction: "in", kind: inb.kind, body: inb.text,
    payload: inb.replyId ? { replyId: inb.replyId } : null, waMessageId: inb.waMessageId, sentBy: "customer", status: "received",
  });
  await db.update(schema.conversations).set({
    lastInboundAt: at, lastMessageAt: at, lastMessageText: inb.text.slice(0, 120), unread: conversation.unread + 1,
  }).where(eq(schema.conversations.id, conversation.id));

  if (!business.botEnabled || conversation.botPaused) return;

  const run = new Run(business, contact, conversation, now ?? DateTime.now().setZone(business.timezone));
  try {
    await run.handle(inb);
  } catch (e) {
    await logEvent(businessId, "error", "engine_error", "שגיאה בהרצת האוטומציה", { error: e instanceof Error ? e.stack : String(e) });
    await db.update(schema.conversations).set({ state: null }).where(eq(schema.conversations.id, conversation.id));
    await deliver(business, conversation, contact, { type: "text", text: "משהו השתבש אצלנו 😕 אפשר לנסות שוב או לכתוב \"נציג\"." }, "system");
  }
}

import { describe, it, expect, beforeAll } from "vitest";
import { DateTime } from "luxon";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { processInbound } from "@/engine/engine";
import { runDueJobs } from "@/engine/jobs";
import { setAiOverride } from "@/engine/ai";
import { createBusiness, addAutomationFromTemplate } from "@/lib/setup";
import { parseDay, parseTime } from "@/lib/time";
import { toWhatsAppPayload } from "@/engine/kapso";
import type { OutMsg } from "@/engine/types";

// Monday 2026-11-16 10:00 in Israel. Sun–Thu 09:00–17:00, Fri 09:00–13:00, Sat closed.
const NOW = DateTime.fromISO("2026-11-16T10:00", { zone: "Asia/Jerusalem" });
let bizId = "";
let n = 0;
const newUser = () => `sim-${++n}`;

async function say(wa: string, text: string, now = NOW) {
  await processInbound(bizId, wa, "", { kind: "text", text }, now);
  return last(wa);
}
async function tap(wa: string, replyId: string, now = NOW) {
  await processInbound(bizId, wa, "", { kind: "reply", text: replyId, replyId }, now);
  return last(wa);
}
async function outbox(wa: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.waId, wa));
  const [conv] = await db.select().from(schema.conversations).where(eq(schema.conversations.contactId, c.id));
  const rows = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id)).orderBy(asc(schema.messages.createdAt));
  return { conv, out: rows.filter((m) => m.direction === "out").map((m) => m.payload as unknown as OutMsg) };
}
const last = async (wa: string) => (await outbox(wa)).out.at(-1)!;
const rows = (m: OutMsg) => (m.type === "list" ? m.rows.map((r) => r.id) : m.type === "buttons" ? m.buttons.map((b) => b.id) : []);
async function appts() {
  const db = await getDb();
  return db.select().from(schema.appointments).where(eq(schema.appointments.businessId, bizId)).orderBy(desc(schema.appointments.createdAt));
}

beforeAll(async () => {
  const b = await createBusiness({
    name: "מספרת דני", address: "הרצל 10, תל אביב",
    services: [{ name: "תספורת גבר", durationMin: 30, price: 80 }, { name: "תספורת + זקן", durationMin: 60, price: 120 }],
  });
  bizId = b.id;
});

describe("static parsing", () => {
  it("parses Hebrew days", () => {
    expect(parseDay("מחר", NOW)).toBe("2026-11-17");
    expect(parseDay("היום בבקשה", NOW)).toBe("2026-11-16");
    expect(parseDay("ביום חמישי", NOW)).toBe("2026-11-19");
    expect(parseDay("20/11", NOW)).toBe("2026-11-20");
    expect(parseDay("בלה בלה", NOW)).toBeNull();
  });
  it("parses times", () => {
    expect(parseTime("9")).toBe("09:00");
    expect(parseTime("14:30")).toBe("14:30");
    expect(parseTime("ב-9 וחצי")).toBe("09:30");
    expect(parseTime("אין")).toBeNull();
  });
  it("enforces WhatsApp limits in payloads", () => {
    const p = toWhatsAppPayload("972500000000", {
      type: "list", text: "x", button: "כפתור ארוך מאוד מאוד מאוד מאוד",
      rows: Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, title: "כותרת ארוכה מאוד מאוד מאוד מאוד מאוד", description: "ד" })),
    }) as { interactive: { action: { button: string; sections: { rows: { title: string }[] }[] } } };
    expect(p.interactive.action.button.length).toBeLessThanOrEqual(20);
    expect(p.interactive.action.sections[0].rows.length).toBe(10);
    expect(p.interactive.action.sections[0].rows[0].title.length).toBeLessThanOrEqual(24);
  });
});

describe("appointment booking flow", () => {
  const wa = newUser();
  it("books an appointment end to end", async () => {
    let m = await say(wa, "היי");
    expect(m.type).toBe("list");
    expect(rows(m)).toEqual(["book", "mine", "info", "human"]);

    m = await tap(wa, "book");
    expect(m.type).toBe("list");
    expect(rows(m).length).toBe(2);

    m = await tap(wa, rows(m)[0]); // 30 min haircut
    expect(rows(m)[0]).toBe("day:2026-11-16");
    expect(rows(m)).not.toContain("day:2026-11-21"); // Saturday is closed
    expect(rows(m).at(-1)).toBe("day:more");

    m = await tap(wa, "day:2026-11-17");
    expect(rows(m)[0]).toBe("time:09:00");
    expect(rows(m)).toContain("time:more");
    expect(rows(m).at(-1)).toBe("time:back");

    m = await tap(wa, "time:09:30");
    expect(m.type).toBe("text");
    m = await say(wa, "יוסי כהן");
    expect(m.type).toBe("buttons");
    expect(m.text).toContain("יוסי כהן");
    expect(m.text).toContain("09:30");

    m = await tap(wa, "ok:yes");
    expect(m.text).toContain("התור נקבע");
    const [a] = await appts();
    expect(a.customerName).toBe("יוסי כהן");
    expect(a.serviceName).toBe("תספורת גבר");
    expect(DateTime.fromJSDate(a.startAt, { zone: "Asia/Jerusalem" }).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-11-17 09:30");
    expect((await outbox(wa)).conv.state).toBeNull();
  });

  it("hides the taken slot from the next customer and blocks overlaps", async () => {
    const wb = newUser();
    await say(wb, "שלום");
    let m = await tap(wb, "book");
    m = await tap(wb, rows(m)[1]); // 60 min service
    m = await tap(wb, "day:2026-11-17");
    expect(rows(m)).not.toContain("time:09:00"); // 09:00–10:00 overlaps 09:30–10:00
    expect(rows(m)).not.toContain("time:09:30");
    expect(rows(m)).toContain("time:10:00");
    m = await say(wb, "9:30");
    expect(m.type).toBe("list"); // re-prompted, not booked
  });

  it("today respects lead time", async () => {
    const wc = newUser();
    await say(wc, "היי");
    let m = await tap(wc, "book");
    m = await tap(wc, rows(m)[0]);
    m = await tap(wc, "day:2026-11-16");
    expect(rows(m)[0]).toBe("time:11:00"); // now 10:00 + 60 min lead
  });

  it("accepts typed answers instead of taps", async () => {
    const wd = newUser();
    await say(wd, "היי");
    await say(wd, "1");
    await say(wd, "תספורת גבר");
    let m = await say(wd, "מחר");
    expect(rows(m)).toContain("time:10:00");
    m = await say(wd, "10");
    m = await say(wd, "דנה");
    m = await say(wd, "כן");
    expect(m.text).toContain("התור נקבע");
  });

  it("re-prompts on nonsense and resets on תפריט", async () => {
    const we = newUser();
    await say(we, "היי");
    let m = await say(we, "אבגדהוז");
    expect(m.type).toBe("list");
    const { out } = await outbox(we);
    expect(out.at(-2)!.text).toContain("לא הצלחתי להבין");
    await tap(we, "book");
    m = await say(we, "תפריט");
    expect(rows(m)).toEqual(["book", "mine", "info", "human"]);
  });

  it("lets the customer change the date at confirmation", async () => {
    const wf = newUser();
    await say(wf, "היי");
    let m = await tap(wf, "book");
    m = await tap(wf, rows(m)[0]);
    await tap(wf, "day:2026-11-18");
    await tap(wf, "time:12:00");
    await say(wf, "רון");
    m = await tap(wf, "ok:change");
    expect(rows(m)[0]).toMatch(/^day:/);
    await tap(wf, "day:2026-11-19");
    m = await tap(wf, "time:12:00");
    expect(m.type).toBe("text"); // asks the name again
    m = await say(wf, "רון");
    m = await tap(wf, "ok:cancel");
    expect(m.text).toContain("לא קבעתי");
    expect((await appts()).some((a) => a.customerName === "רון")).toBe(false);
  });

  it("refuses a slot that was taken between choosing and confirming", async () => {
    const a = newUser(), b = newUser();
    for (const w of [a, b]) {
      await say(w, "היי");
      const m = await tap(w, "book");
      await tap(w, rows(m)[0]);
      await tap(w, "day:2026-11-18");
      await tap(w, "time:15:00");
      await say(w, w === a ? "ראשון בתור" : "שני בתור");
    }
    expect((await tap(a, "ok:yes")).text).toContain("התור נקבע");
    const m = await tap(b, "ok:yes");
    expect(m.type).toBe("list");
    expect(rows(m)).not.toContain("time:15:00");
    expect((await appts()).filter((x) => x.customerName === "שני בתור").length).toBe(0);
  });

  it("shows and cancels my appointments", async () => {
    await say(wa, "תפריט");
    let m = await tap(wa, "mine");
    expect(rows(m).length).toBe(2);
    expect(rows(m)[0]).toMatch(/^cancel:/);
    m = await tap(wa, rows(m)[0]);
    expect(m.text).toContain("בוטל");
    const mine = (await appts()).find((x) => x.customerName === "יוסי כהן")!;
    expect(mine.status).toBe("cancelled");
    const db = await getDb();
    const js = await db.select().from(schema.jobs);
    expect(js.find((j) => j.payload.appointmentId === mine.id)!.status).toBe("cancelled");
    // the slot is free again
    const w = newUser();
    await say(w, "היי");
    m = await tap(w, "book");
    m = await tap(w, rows(m)[0]);
    m = await tap(w, "day:2026-11-17");
    expect(rows(m)).toContain("time:09:30");
  });

  it("shows info then returns to the menu, and hands off to a human", async () => {
    const w = newUser();
    await say(w, "היי");
    const m = await tap(w, "info");
    expect(rows(m)).toEqual(["book", "mine", "info", "human"]);
    const { out } = await outbox(w);
    expect(out.at(-2)!.text).toContain("הרצל 10");
    expect(out.at(-2)!.text).toContain("שבת: סגור");
    await tap(w, "human");
    const o = await outbox(w);
    expect(o.conv.botPaused).toBe(true);
    expect(o.conv.needsHuman).toBe(true);
    const before = o.out.length;
    await say(w, "הלו?");
    expect((await outbox(w)).out.length).toBe(before); // bot stays silent while paused
  });
});

describe("reminders", () => {
  it("sends a reminder with buttons and handles the reply", async () => {
    const w = newUser();
    await say(w, "היי");
    let m = await tap(w, "book");
    m = await tap(w, rows(m)[0]);
    await tap(w, "day:2026-11-19");
    await tap(w, "time:16:00");
    await say(w, "מיכל");
    await tap(w, "ok:yes");
    const db = await getDb();
    const appt = (await appts()).find((x) => x.customerName === "מיכל")!;
    const [job] = (await db.select().from(schema.jobs)).filter((j) => j.payload.appointmentId === appt.id);
    expect(DateTime.fromJSDate(job.runAt, { zone: "Asia/Jerusalem" }).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-11-18 16:00");
    // make the appointment real-future and the job due, then tick
    const start = new Date(Date.now() + 3 * 3600_000);
    await db.update(schema.appointments).set({ startAt: start, endAt: new Date(start.getTime() + 1800_000) }).where(eq(schema.appointments.id, appt.id));
    await db.update(schema.jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(schema.jobs.id, job.id));
    const r = await runDueJobs();
    expect(r.done).toBeGreaterThanOrEqual(1);
    m = await last(w);
    expect(m.type).toBe("buttons");
    expect(rows(m)).toEqual([`appt:ok:${appt.id}`, `appt:no:${appt.id}`]);
    expect((await runDueJobs()).done).toBe(0); // never sent twice
    m = await tap(w, `appt:ok:${appt.id}`, DateTime.now().setZone("Asia/Jerusalem"));
    expect(m.text).toContain("נתראה");
    expect((await appts()).find((x) => x.id === appt.id)!.status).toBe("confirmed");
  });
});

describe("other templates and AI", () => {
  it("lead capture is triggered by keyword and logs a notification", async () => {
    await addAutomationFromTemplate(bizId, "leads");
    const w = newUser();
    let m = await say(w, "אשמח להצעת מחיר");
    expect(m.text).toContain("איך קוראים לך");
    await say(w, "אבי לוי");
    m = await say(w, "צריך תספורת לאירוע של 10 אנשים");
    expect(m.text).toContain("תודה אבי לוי");
    const db = await getDb();
    const ev = await db.select().from(schema.events).where(eq(schema.events.type, "owner_notify"));
    expect(ev.some((e) => e.message.includes("אבי לוי") && e.message.includes("10 אנשים"))).toBe(true);
  });

  it("AI hints are validated by the static engine", async () => {
    const db = await getDb();
    const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, bizId));
    await db.update(schema.businesses).set({ settings: { ...b.settings, aiEnabled: true } }).where(eq(schema.businesses.id, bizId));
    const svc = (await db.select().from(schema.services).where(eq(schema.services.businessId, bizId))).find((s) => s.durationMin === 30)!;

    // 1) valid request: jumps straight to asking the name
    setAiOverride(async () => ({ intent: "book", serviceId: svc.id, date: "2026-11-22", time: "11:00" }));
    const w1 = newUser();
    let m = await say(w1, "אפשר תספורת ביום ראשון ב-11?");
    expect(m.type).toBe("text");
    expect(m.text).toContain("על איזה שם");
    m = await say(w1, "גיל");
    expect(m.text).toContain("11:00");

    // 2) the model "hallucinates" Saturday 03:00: engine refuses and offers real days
    setAiOverride(async () => ({ intent: "book", serviceId: svc.id, date: "2026-11-21", time: "03:00" }));
    const w2 = newUser();
    m = await say(w2, "תקבע לי תור בשבת בשלוש בלילה");
    expect(m.type).toBe("list");
    expect(rows(m)[0]).toMatch(/^day:/);
    expect((await outbox(w2)).out.at(-2)!.text).toContain("אין תורים פנויים");

    // 3) question gets an answer and then the menu
    setAiOverride(async () => ({ intent: "question", answer: "אנחנו ברחוב הרצל 10." }));
    const w3 = newUser();
    m = await say(w3, "איפה אתם נמצאים בדיוק?");
    expect(rows(m)).toEqual(["book", "mine", "info", "human"]);
    expect((await outbox(w3)).out.at(-2)!.text).toBe("אנחנו ברחוב הרצל 10.");

    // 4) AI failure falls back to the normal menu
    setAiOverride(async () => null);
    const w4 = newUser();
    m = await say(w4, "מה קורה אחי היקר");
    expect(rows(m)).toEqual(["book", "mine", "info", "human"]);
    setAiOverride(null);
  });

  it("stays silent when the bot is disabled for the business", async () => {
    const db = await getDb();
    await db.update(schema.businesses).set({ botEnabled: false }).where(eq(schema.businesses.id, bizId));
    const w = newUser();
    await processInbound(bizId, w, "", { kind: "text", text: "היי" }, NOW);
    expect((await outbox(w)).out.length).toBe(0);
    await db.update(schema.businesses).set({ botEnabled: true }).where(eq(schema.businesses.id, bizId));
  });
});

import type { DateTime } from "luxon";
import type { Business, Service } from "@/db/schema";
import { hoursText } from "@/lib/defaults";
import { DAY_NAMES, dayIndex } from "@/lib/time";
import { logEvent } from "@/lib/log";

export type AiResult = {
  intent: "book" | "cancel" | "human" | "question" | "other";
  serviceId?: string | null;
  date?: string | null;
  time?: string | null;
  answer?: string | null;
};

type AiFn = (business: Business, services: Service[], text: string, now: DateTime) => Promise<AiResult | null>;
let override: AiFn | null = null;
/** Tests inject a fake model here. */
export const setAiOverride = (fn: AiFn | null) => { override = fn; };

export const aiAvailable = (business: Business) =>
  business.settings.aiEnabled && (!!override || (!!process.env.OPENAI_API_KEY && !!process.env.OPENAI_MODEL));

/**
 * The model only *understands* free text. It never books anything:
 * whatever it returns is re-validated by the static engine against real availability.
 */
export async function aiInterpret(business: Business, services: Service[], text: string, now: DateTime): Promise<AiResult | null> {
  if (override) return override(business, services, text, now);
  const system = [
    `You classify a WhatsApp message sent to the business "${business.name}". Reply with JSON only.`,
    `Schema: {"intent":"book"|"cancel"|"human"|"question"|"other","service_id":string|null,"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"answer":string|null}`,
    `Today is ${now.toISODate()} (יום ${DAY_NAMES[dayIndex(now)]}), local time ${now.toFormat("HH:mm")}, timezone ${business.timezone}.`,
    `Services: ${JSON.stringify(services.map((s) => ({ id: s.id, name: s.name, minutes: s.durationMin, price: s.price })))}`,
    `Business info - address: ${business.address || "לא צוין"}. Hours:\n${hoursText(business.hours)}\nAbout: ${business.about || "-"}`,
    `Rules: "book" = wants an appointment (fill service_id/date/time only if clearly stated, resolve relative dates). "cancel" = wants to cancel or see appointments. "human" = asks for a person. "question" = asks about the business: put a short Hebrew answer in "answer" using ONLY the info above; if the info is missing use intent "human". Otherwise "other". Never invent facts or availability.`,
  ].join("\n");
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: text.slice(0, 600) }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const j = JSON.parse(data.choices[0].message.content);
    return { intent: j.intent ?? "other", serviceId: j.service_id, date: j.date, time: j.time, answer: j.answer };
  } catch (e) {
    await logEvent(business.id, "warn", "ai_failed", "הפנייה ל-AI נכשלה, ממשיך בלוגיקה רגילה", { error: String(e) });
    return null;
  }
}

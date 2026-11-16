import { DateTime } from "luxon";

export const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const DAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

export const dayIndex = (d: DateTime) => d.weekday % 7; // luxon: 1=Mon..7=Sun -> 0=Sun..6=Sat

export function fmtDay(iso: string, tz: string, short = false) {
  const d = DateTime.fromISO(iso, { zone: tz });
  return `יום ${short ? DAY_SHORT[dayIndex(d)] : DAY_NAMES[dayIndex(d)]} ${d.toFormat("d/M")}`;
}
export function fmtDateTime(date: Date, tz: string) {
  const d = DateTime.fromJSDate(date, { zone: tz });
  return `יום ${DAY_NAMES[dayIndex(d)]} ${d.toFormat("d/M")} בשעה ${d.toFormat("HH:mm")}`;
}
export const fmtTime = (date: Date, tz: string) => DateTime.fromJSDate(date, { zone: tz }).toFormat("HH:mm");
export const isoDate = (date: Date, tz: string) => DateTime.fromJSDate(date, { zone: tz }).toISODate()!;

export function relativeDayLabel(iso: string, now: DateTime) {
  const diff = Math.round(DateTime.fromISO(iso, { zone: now.zone }).startOf("day").diff(now.startOf("day"), "days").days);
  return diff === 0 ? "היום" : diff === 1 ? "מחר" : diff === 2 ? "מחרתיים" : "";
}

/** Static Hebrew date parsing: היום / מחר / מחרתיים / weekday names / d/m / d.m */
export function parseDay(text: string, now: DateTime): string | null {
  const t = text.trim();
  if (/היום/.test(t)) return now.toISODate();
  if (/מחרתיים/.test(t)) return now.plus({ days: 2 }).toISODate();
  if (/מחר/.test(t)) return now.plus({ days: 1 }).toISODate();
  const m = t.match(/(\d{1,2})[./-](\d{1,2})/);
  if (m) {
    let d = DateTime.fromObject({ year: now.year, month: +m[2], day: +m[1] }, { zone: now.zone });
    if (!d.isValid) return null;
    if (d < now.startOf("day")) d = d.plus({ years: 1 });
    return d.toISODate();
  }
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`(^|\\s|ב|ל)(יום\\s+)?${DAY_NAMES[i]}($|\\s|[,.!?])`).test(t)) {
      for (let k = 0; k < 7; k++) {
        const d = now.plus({ days: k });
        if (dayIndex(d) === i) return d.toISODate();
      }
    }
  }
  return null;
}

/** "9", "9:30", "09.30", "בשעה 14" -> "HH:mm" */
export function parseTime(text: string): string | null {
  const m = text.match(/(\d{1,2})(?:[:.](\d{2}))?/);
  if (!m) return null;
  const h = +m[1], min = m[2] ? +m[2] : /וחצי/.test(text) ? 30 : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

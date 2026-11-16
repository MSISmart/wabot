import type { BizSettings, Hours } from "@/db/schema";
import { DAY_NAMES } from "./time";

export const defaultHours: Hours = {
  "0": [["09:00", "17:00"]], "1": [["09:00", "17:00"]], "2": [["09:00", "17:00"]],
  "3": [["09:00", "17:00"]], "4": [["09:00", "17:00"]], "5": [["09:00", "13:00"]], "6": [],
};
export const defaultSettings: BizSettings = {
  slotMinutes: 30, leadMinutes: 60, maxDaysAhead: 14, reminderHours: 24, aiEnabled: false,
};

export function hoursText(hours: Hours) {
  return DAY_NAMES.map((n, i) => {
    const r = hours[String(i)] ?? [];
    return `${n}: ${r.length ? r.map(([a, b]) => `${a}–${b}`).join(", ") : "סגור"}`;
  }).join("\n");
}

export const appUrl = () =>
  (process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/$/, "");

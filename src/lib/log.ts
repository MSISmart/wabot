import { getDb, schema } from "@/db";

export async function logEvent(
  businessId: string | null, level: "info" | "warn" | "error", type: string, message: string, data?: Record<string, unknown>,
) {
  try {
    const db = await getDb();
    await db.insert(schema.events).values({ businessId, level, type, message, data });
  } catch (e) {
    console.error("logEvent failed", e);
  }
  if (level === "error") console.error(`[${type}] ${message}`, data ?? "");
}

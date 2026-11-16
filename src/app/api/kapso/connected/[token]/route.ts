import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { kapsoRegisterWebhook } from "@/engine/kapso";
import { verifyToken } from "@/lib/auth";
import { appUrl } from "@/lib/defaults";
import { logEvent } from "@/lib/log";

/** Kapso sends the business owner here after they connect their WhatsApp number through the setup link. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const q = new URL(req.url).searchParams;
  const token = await verifyToken((await params).token);
  const businessId = token?.connectBusiness;
  if (!businessId) redirect("/connected?ok=0");
  const phoneNumberId = q.get("phone_number_id");
  if (!phoneNumberId) {
    await logEvent(businessId, "error", "whatsapp_connect_failed", "חיבור מספר הוואטסאפ לא הושלם");
    redirect("/connected?ok=0");
  }
  const db = await getDb();
  await db.update(schema.businesses).set({ phoneNumberId, displayPhone: q.get("display_phone_number") })
    .where(eq(schema.businesses.id, businessId));
  await logEvent(businessId, "info", "whatsapp_connected", `מספר וואטסאפ חובר (${q.get("display_phone_number") ?? phoneNumberId})`);
  try {
    if (!process.env.KAPSO_WEBHOOK_SECRET) throw new Error("KAPSO_WEBHOOK_SECRET לא מוגדר");
    await kapsoRegisterWebhook(phoneNumberId, `${appUrl()}/api/webhooks/kapso`, process.env.KAPSO_WEBHOOK_SECRET);
  } catch (e) {
    await logEvent(businessId, "error", "webhook_register_failed", "המספר חובר אבל רישום ה-webhook נכשל. אפשר לנסות שוב ממסך ההגדרות", { error: String(e) });
  }
  redirect("/connected?ok=1");
}

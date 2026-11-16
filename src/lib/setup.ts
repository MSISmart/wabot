import bcrypt from "bcryptjs";
import { getDb, schema } from "@/db";
import { defaultHours, defaultSettings } from "./defaults";
import { getTemplate } from "@/engine/templates";

export async function addAutomationFromTemplate(businessId: string, key: string) {
  const t = getTemplate(key);
  if (!t) throw new Error("תבנית לא קיימת");
  const db = await getDb();
  const [a] = await db.insert(schema.automations).values({
    businessId, name: t.name, templateKey: t.key, trigger: structuredClone(t.trigger), definition: structuredClone(t.definition),
  }).returning();
  return a;
}

/** Creates a business that works out of the box: default hours, the appointments automation and starter services. */
export async function createBusiness(input: { name: string; address?: string; ownerPhone?: string; services?: { name: string; durationMin: number; price?: number }[] }) {
  const db = await getDb();
  const [b] = await db.insert(schema.businesses).values({
    name: input.name, address: input.address ?? "", ownerPhone: input.ownerPhone ?? "",
    hours: structuredClone(defaultHours), settings: { ...defaultSettings },
  }).returning();
  const svcs = input.services ?? [{ name: "פגישה", durationMin: 30 }];
  await db.insert(schema.services).values(svcs.map((s, i) => ({ businessId: b.id, name: s.name, durationMin: s.durationMin, price: s.price ?? null, sort: i })));
  await addAutomationFromTemplate(b.id, "appointments");
  return b;
}

export async function createUser(input: { email: string; password: string; name?: string; role: "admin" | "owner"; businessId?: string | null }) {
  const db = await getDb();
  const [u] = await db.insert(schema.users).values({
    email: input.email.trim().toLowerCase(), passwordHash: await bcrypt.hash(input.password, 10),
    name: input.name ?? "", role: input.role, businessId: input.businessId ?? null,
  }).returning();
  return u;
}

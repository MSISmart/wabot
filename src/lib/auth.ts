import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { User } from "@/db/schema";

const COOKIE = "wabot_session";

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production" && !process.env.ALLOW_INSECURE_SECRET) {
    throw new Error("AUTH_SECRET is not set");
  }
  return new TextEncoder().encode(s ?? "dev-only-secret-change-me");
}

export async function signToken(payload: Record<string, string>, expires = "30d") {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(expires).sign(secret());
}
export async function verifyToken(token: string) {
  try { return (await jwtVerify(token, secret())).payload as Record<string, string>; } catch { return null; }
}

export async function createSession(userId: string) {
  const token = await signToken({ uid: userId });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}
export async function destroySession() { (await cookies()).delete(COOKIE); }

export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const p = await verifyToken(token);
  if (!p?.uid) return null;
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, p.uid)).limit(1);
  return u ?? null;
}

export async function requireUser(): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}
export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (u.role !== "admin") redirect("/");
  return u;
}
/** Every business-scoped page and action goes through this: admin sees all, an owner only their own business. */
export async function requireBusiness(businessId: string) {
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) redirect("/");
  if (user.role !== "admin" && user.businessId !== businessId) redirect("/");
  const db = await getDb();
  const [business] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).limit(1);
  if (!business) redirect("/");
  return { user, business };
}

/** Same check as requireBusiness, for API routes: returns null instead of redirecting. */
export async function apiBusiness(businessId: string) {
  const user = await getUser();
  if (!user || !/^[0-9a-f-]{36}$/i.test(businessId)) return null;
  if (user.role !== "admin" && user.businessId !== businessId) return null;
  const db = await getDb();
  const [business] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).limit(1);
  return business ? { user, business } : null;
}

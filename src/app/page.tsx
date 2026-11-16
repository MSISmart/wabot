import { count } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  if (n === 0) redirect("/setup");
  const user = await getUser();
  if (!user) redirect("/login");
  redirect(user.role === "admin" ? "/admin" : user.businessId ? `/b/${user.businessId}` : "/login");
}

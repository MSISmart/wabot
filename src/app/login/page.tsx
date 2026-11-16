import { count } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { loginAction } from "@/app/actions";
import { AuthShell } from "@/components/auth-shell";
import { Flash } from "@/components/flash";
import { Submit } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  if (n === 0) redirect("/setup");
  return (
    <AuthShell title="כניסה לפאנל" sub="ניהול הבוטים של העסק בוואטסאפ">
      <Flash sp={await searchParams} />
      <form action={loginAction} className="space-y-4">
        <div><label className="label" htmlFor="email">אימייל</label><input id="email" name="email" type="email" required dir="ltr" autoComplete="username" className="input" /></div>
        <div><label className="label" htmlFor="password">סיסמה</label><input id="password" name="password" type="password" required dir="ltr" autoComplete="current-password" className="input" /></div>
        <Submit className="btn btn-primary w-full">כניסה</Submit>
      </form>
    </AuthShell>
  );
}

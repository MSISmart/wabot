import { count } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { setupAction } from "@/app/actions";
import { AuthShell } from "@/components/auth-shell";
import { Flash } from "@/components/flash";
import { Submit } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Setup({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  if (n > 0) redirect("/login");
  return (
    <AuthShell title="הקמה ראשונית" sub="יוצרים את משתמש המנהל. המסך הזה מופיע פעם אחת בלבד">
      <Flash sp={await searchParams} />
      <form action={setupAction} className="space-y-4">
        <div><label className="label" htmlFor="name">שם</label><input id="name" name="name" className="input" /></div>
        <div><label className="label" htmlFor="email">אימייל</label><input id="email" name="email" type="email" required dir="ltr" className="input" /></div>
        <div><label className="label" htmlFor="password">סיסמה (8 תווים לפחות)</label><input id="password" name="password" type="password" required minLength={8} dir="ltr" autoComplete="new-password" className="input" /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="demo" defaultChecked /> ליצור עסק הדגמה כדי לנסות את הבוט מיד</label>
        <Submit className="btn btn-primary w-full">יצירת מנהל וכניסה</Submit>
      </form>
    </AuthShell>
  );
}

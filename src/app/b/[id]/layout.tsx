import Link from "next/link";
import { and, count, eq, or, gt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { logoutAction, toggleBotAction } from "@/app/actions";
import { NavLink } from "@/components/ui";
import { requireBusiness } from "@/lib/auth";

export default async function BusinessLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business } = await requireBusiness(id);
  const db = await getDb();
  const [{ n: attention }] = await db.select({ n: count() }).from(schema.conversations)
    .where(and(eq(schema.conversations.businessId, id), or(eq(schema.conversations.needsHuman, true), gt(schema.conversations.unread, 0))));
  const base = `/b/${id}`;

  return (
    <div className="min-h-screen md:flex">
      <aside className="bg-bottle-deep text-white md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col">
        <div className="px-4 pt-4 pb-3 md:pt-6">
          {user.role === "admin" && <Link href="/admin" className="mb-3 block text-[0.8rem] text-white/60 hover:text-white">→ כל העסקים</Link>}
          <p className="text-lg font-semibold leading-tight">{business.name}</p>
          <form action={toggleBotAction.bind(null, id)} className="mt-3">
            <button className="flex w-full items-center justify-between rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15" aria-pressed={business.botEnabled}>
              <span>{business.botEnabled ? "הבוט עונה ללקוחות" : "הבוט כבוי"}</span>
              <span className={`relative h-5 w-9 rounded-full transition-colors ${business.botEnabled ? "bg-[#4fd1a1]" : "bg-white/25"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${business.botEnabled ? "right-0.5" : "right-[1.125rem]"}`} />
              </span>
            </button>
          </form>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible" aria-label="ניווט ראשי">
          <NavLink href={base} exact>היום</NavLink>
          <NavLink href={`${base}/appointments`}>תורים</NavLink>
          <NavLink href={`${base}/inbox`}>
            שיחות {attention > 0 && <span className="rounded-full bg-[#f5b93f] px-1.5 text-[0.72rem] font-semibold text-bottle-deep">{attention}</span>}
          </NavLink>
          <NavLink href={`${base}/automations`}>אוטומציות</NavLink>
          <NavLink href={`${base}/simulator`}>בדיקת הבוט</NavLink>
          <NavLink href={`${base}/settings`}>הגדרות</NavLink>
          <NavLink href={`${base}/logs`}>יומן אירועים</NavLink>
        </nav>
        <form action={logoutAction} className="hidden border-t border-white/10 px-4 py-3 text-[0.8rem] text-white/60 md:block">
          <span className="block truncate" dir="ltr">{user.email}</span>
          <button className="mt-1 hover:text-white">יציאה</button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 md:py-8">{children}</main>
    </div>
  );
}

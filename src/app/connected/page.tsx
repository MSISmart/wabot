import { AuthShell } from "@/components/auth-shell";

export default async function Connected({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const ok = (await searchParams).ok === "1";
  return (
    <AuthShell title={ok ? "המספר חובר" : "החיבור לא הושלם"} sub="חיבור וואטסאפ לעסק">
      <p>{ok
        ? "מספר הוואטסאפ של העסק מחובר עכשיו לבוט. אפשר לסגור את החלון."
        : "משהו השתבש בתהליך החיבור. אפשר לפתוח שוב את הלינק שקיבלתם ולנסות מחדש, או לפנות למי ששלח אותו."}</p>
    </AuthShell>
  );
}

import { Chat } from "@/components/chat";
import { PageHead } from "@/components/flash";
import { requireBusiness } from "@/lib/auth";

export default async function Simulator({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await requireBusiness(id);
  return (
    <div className="max-w-4xl">
      <PageHead title="בדיקת הבוט" sub="שיחה עם הבוט בדיוק כמו שלקוח רואה אותה, בלי לשלוח הודעות אמיתיות" />
      <div className="grid items-start gap-8 lg:grid-cols-[23rem_1fr]">
        <div className="mx-auto w-full max-w-[23rem] overflow-hidden rounded-[2rem] border-[7px] border-ink bg-surface shadow-[0_18px_40px_-18px_rgba(16,35,28,0.45)]">
          <div className="flex items-center gap-2.5 bg-bottle-deep px-4 py-3 text-white">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-sm font-semibold">{business.name.slice(0, 1)}</span>
            <span><span className="block text-[0.92rem] font-medium leading-tight">{business.name}</span><span className="block text-[0.7rem] text-white/65">חשבון עסקי</span></span>
          </div>
          <div className="h-[32rem]"><Chat businessId={id} conversationId={null} mode="sim" /></div>
        </div>
        <div className="space-y-4 text-sm">
          <section className="panel p-5">
            <h2 className="mb-2">איך בודקים</h2>
            <ul className="list-disc space-y-1.5 pr-5 text-muted marker:text-line">
              <li>כותבים הודעה ראשונה, למשל "היי", ולוחצים על הכפתורים שהבוט שולח.</li>
              <li>אפשר גם להקליד תשובה במקום ללחוץ: "מחר", "10:30", "כן".</li>
              <li>"תפריט" מתחיל מחדש. "נציג" מעביר לטיפול אנושי ומשהה את הבוט.</li>
              <li>תור שנקבע כאן הוא תור אמיתי במערכת, ומופיע במסך התורים. אפשר לבטל אותו משם.</li>
            </ul>
          </section>
          <p className="hint">הסימולטור מריץ את אותו מנוע שעונה בוואטסאפ. מה שעובד כאן יעבוד גם אצל הלקוחות.{!business.botEnabled && " שימו לב: הבוט כבוי כרגע ולכן לא יענה גם כאן."}</p>
        </div>
      </div>
    </div>
  );
}

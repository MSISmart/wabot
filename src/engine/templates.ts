import type { Definition, Trigger } from "./types";

export type AutomationTemplate = {
  key: string;
  name: string;
  description: string;
  trigger: Trigger;
  definition: Definition;
};

export const TEMPLATES: AutomationTemplate[] = [
  {
    key: "appointments",
    name: "קביעת תורים",
    description: "תפריט ראשי, בחירת שירות, יום ושעה פנויים, אישור, תזכורת לפני התור וביטול תורים.",
    trigger: { type: "default" },
    definition: {
      start: "main",
      steps: [
        {
          id: "main", type: "menu", buttonLabel: "לבחירה",
          text: "שלום! 👋 הגעת ל{{business}}.\nאיך אפשר לעזור?",
          options: [
            { id: "book", label: "קביעת תור", description: "בחירת שירות, יום ושעה", next: "service" },
            { id: "mine", label: "התורים שלי", description: "צפייה וביטול", next: "mine" },
            { id: "info", label: "שעות וכתובת", next: "info" },
            { id: "human", label: "שיחה עם נציג", next: "human" },
          ],
        },
        { id: "service", type: "pick_service", text: "לאיזה שירות לקבוע?", next: "day" },
        { id: "day", type: "pick_day", text: "באיזה יום נוח לך?", noSlotsText: "כרגע אין תורים פנויים בימים הקרובים 😕\nאפשר לכתוב \"נציג\" ונחזור אליך.", next: "time" },
        { id: "time", type: "pick_time", text: "השעות הפנויות ב{{date}}:", next: "name" },
        { id: "name", type: "ask", saveAs: "name", validate: "name", text: "על איזה שם לרשום את התור?", next: "confirm" },
        { id: "confirm", type: "confirm_booking", text: "רק לוודא:\n\n💈 {{service}}\n📅 {{date}}\n🕐 {{time}}\n👤 {{name}}\n\nלקבוע?", cancelText: "בסדר, לא קבעתי כלום. אפשר לכתוב \"תפריט\" בכל רגע.", next: "create" },
        { id: "create", type: "create_booking", successText: "התור נקבע ✅\n{{service}}, {{date}} בשעה {{time}}.\n📍 {{address}}\n\nנשלח תזכורת לפני התור. לביטול: \"תפריט\" ← \"התורים שלי\".", takenText: "אוי, השעה הזאת נתפסה ממש עכשיו. בחר/י שעה אחרת:" },
        { id: "mine", type: "my_appointments", text: "התורים הקרובים שלך. לבחור תור כדי לבטל אותו:", emptyText: "אין לך תורים קרובים. לקביעת תור אפשר לכתוב \"תפריט\".", cancelledText: "התור בוטל. נשמח לראות אותך בפעם אחרת 🙏" },
        { id: "info", type: "message", text: "{{business}}\n📍 {{address}}\n\nשעות פעילות:\n{{hours}}", next: "main" },
        { id: "human", type: "handoff", text: "העברתי את השיחה לנציג, נחזור אליך בהקדם 🙏" },
      ],
    },
  },
  {
    key: "leads",
    name: "קליטת לידים",
    description: "שואל שם ומה הלקוח צריך, שומר את הפנייה ומתריע לבעל העסק.",
    trigger: { type: "keywords", keywords: ["הצעת מחיר", "מחיר", "פרטים"] },
    definition: {
      start: "name",
      steps: [
        { id: "name", type: "ask", saveAs: "name", validate: "name", text: "שמחים שפנית ל{{business}}! איך קוראים לך?", next: "need" },
        { id: "need", type: "ask", saveAs: "need", validate: "text", text: "נעים מאוד {{name}} 🙂 במה אפשר לעזור? אפשר לפרט בכמה מילים.", next: "notify" },
        { id: "notify", type: "notify_owner", text: "ליד חדש 🔔\n{{name}} ({{phone}})\n{{need}}", next: "thanks" },
        { id: "thanks", type: "message", text: "תודה {{name}}! קיבלנו את הפנייה ונחזור אליך בהקדם." },
      ],
    },
  },
  {
    key: "faq",
    name: "תפריט מידע",
    description: "תפריט קצר עם שעות פעילות, כתובת ומעבר לנציג. מתאים לעסק בלי קביעת תורים.",
    trigger: { type: "keywords", keywords: ["מידע", "שעות", "כתובת"] },
    definition: {
      start: "menu",
      steps: [
        {
          id: "menu", type: "menu", text: "מה תרצה/י לדעת על {{business}}?",
          options: [
            { id: "hours", label: "שעות פעילות", next: "hours" },
            { id: "address", label: "כתובת", next: "address" },
            { id: "human", label: "שיחה עם נציג", next: "human" },
          ],
        },
        { id: "hours", type: "message", text: "שעות הפעילות שלנו:\n{{hours}}", next: "menu" },
        { id: "address", type: "message", text: "📍 {{address}}", next: "menu" },
        { id: "human", type: "handoff", text: "העברתי את השיחה לנציג, נחזור אליך בהקדם 🙏" },
      ],
    },
  },
];

export const getTemplate = (key: string) => TEMPLATES.find((t) => t.key === key);

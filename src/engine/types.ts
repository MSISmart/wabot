export type Option = { id: string; label: string; description?: string; next?: string };

export type Step =
  | { id: string; type: "message"; text: string; next?: string }
  | { id: string; type: "menu"; text: string; buttonLabel?: string; options: Option[] }
  | { id: string; type: "ask"; text: string; saveAs: string; validate?: "text" | "name" | "phone"; next?: string }
  | { id: string; type: "pick_service"; text: string; next?: string }
  | { id: string; type: "pick_day"; text: string; noSlotsText: string; next?: string }
  | { id: string; type: "pick_time"; text: string; next?: string }
  | { id: string; type: "confirm_booking"; text: string; cancelText: string; next?: string }
  | { id: string; type: "create_booking"; successText: string; takenText: string; next?: string }
  | { id: string; type: "my_appointments"; text: string; emptyText: string; cancelledText: string; next?: string }
  | { id: string; type: "notify_owner"; text: string; next?: string }
  | { id: string; type: "handoff"; text: string };

export type StepType = Step["type"];
export type Definition = { start: string; steps: Step[] };
export type Trigger = { type: "default" } | { type: "keywords"; keywords: string[] };

export type ConvState = {
  automationId: string;
  stepId: string;
  vars: Record<string, string>;
  awaiting: boolean;
  retries: number;
  at: number;
} | null;

export type OutMsg =
  | { type: "text"; text: string }
  | { type: "buttons"; text: string; buttons: { id: string; title: string }[] }
  | { type: "list"; text: string; button: string; rows: { id: string; title: string; description?: string }[] }
  | { type: "template"; name: string; language: string; params: string[]; text: string };

export type Inbound = {
  kind: "text" | "reply" | "other";
  text: string;
  replyId?: string;
  waMessageId?: string;
};

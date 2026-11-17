import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { ConvState, Definition, Trigger } from "../engine/types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().defaultRandom();
const created = () => ts("created_at").notNull().defaultNow();

export type Hours = Record<string, [string, string][]>; // "0" = Sunday ... "6" = Saturday
export type BizSettings = {
  slotMinutes: number;
  leadMinutes: number;
  maxDaysAhead: number;
  reminderHours: number;
  reminderTemplate?: string;
  reminderTemplateLang?: string;
  aiEnabled: boolean;
};

export const businesses = pgTable("businesses", {
  id: id(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Jerusalem"),
  address: text("address").notNull().default(""),
  about: text("about").notNull().default(""),
  ownerPhone: text("owner_phone").notNull().default(""),
  botEnabled: boolean("bot_enabled").notNull().default(true),
  kapsoCustomerId: text("kapso_customer_id"),
  phoneNumberId: text("phone_number_id").unique(),
  displayPhone: text("display_phone"),
  setupLinkUrl: text("setup_link_url"),
  hours: jsonb("hours").$type<Hours>().notNull(),
  settings: jsonb("settings").$type<BizSettings>().notNull(),
  createdAt: created(),
});

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull().default(""),
  role: text("role").$type<"admin" | "owner">().notNull(),
  businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
  createdAt: created(),
});

export const services = pgTable("services", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  durationMin: integer("duration_min").notNull().default(30),
  price: integer("price"),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
});

export const automations = pgTable("automations", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  templateKey: text("template_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  trigger: jsonb("trigger").$type<Trigger>().notNull(),
  definition: jsonb("definition").$type<Definition>().notNull(),
  createdAt: created(),
});

export const contacts = pgTable("contacts", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  waId: text("wa_id").notNull(),
  name: text("name").notNull().default(""),
  createdAt: created(),
}, (t) => [uniqueIndex("contacts_biz_wa").on(t.businessId, t.waId)]);

export const conversations = pgTable("conversations", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().unique().references(() => contacts.id, { onDelete: "cascade" }),
  state: jsonb("state").$type<ConvState>(),
  botPaused: boolean("bot_paused").notNull().default(false),
  needsHuman: boolean("needs_human").notNull().default(false),
  unread: integer("unread").notNull().default(0),
  lockedUntil: ts("locked_until"),
  botPausedAt: ts("bot_paused_at"),
  lastInboundAt: ts("last_inbound_at"),
  lastMessageAt: ts("last_message_at"),
  lastMessageText: text("last_message_text").notNull().default(""),
  createdAt: created(),
}, (t) => [index("conv_biz_last").on(t.businessId, t.lastMessageAt)]);

export const messages = pgTable("messages", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  direction: text("direction").$type<"in" | "out">().notNull(),
  kind: text("kind").notNull().default("text"),
  body: text("body").notNull().default(""),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  waMessageId: text("wa_message_id"),
  status: text("status").notNull().default("sent"),
  sentBy: text("sent_by").$type<"bot" | "human" | "customer" | "system">().notNull().default("bot"),
  error: text("error"),
  createdAt: created(),
}, (t) => [index("msg_conv_created").on(t.conversationId, t.createdAt), index("msg_wa_id").on(t.waMessageId)]);

export const appointments = pgTable("appointments", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull().default(""),
  customerPhone: text("customer_phone").notNull().default(""),
  serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
  serviceName: text("service_name").notNull().default(""),
  startAt: ts("start_at").notNull(),
  endAt: ts("end_at").notNull(),
  status: text("status").$type<"booked" | "confirmed" | "cancelled" | "completed">().notNull().default("booked"),
  source: text("source").$type<"bot" | "manual">().notNull().default("bot"),
  notes: text("notes").notNull().default(""),
  createdAt: created(),
}, (t) => [index("appt_biz_start").on(t.businessId, t.startAt)]);

export const jobs = pgTable("jobs", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  runAt: ts("run_at").notNull(),
  payload: jsonb("payload").$type<Record<string, string>>().notNull(),
  status: text("status").$type<"pending" | "done" | "failed" | "cancelled">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: created(),
}, (t) => [index("jobs_due").on(t.status, t.runAt)]);

export const events = pgTable("events", {
  id: id(),
  businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
  level: text("level").$type<"info" | "warn" | "error">().notNull().default("info"),
  type: text("type").notNull(),
  message: text("message").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
  createdAt: created(),
}, (t) => [index("events_biz_created").on(t.businessId, t.createdAt)]);

export const webhookEvents = pgTable("webhook_events", {
  key: text("key").primaryKey(),
  createdAt: created(),
});

export type Business = typeof businesses.$inferSelect;
export type User = typeof users.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Job = typeof jobs.$inferSelect;

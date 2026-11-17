ALTER TABLE "conversations" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "bot_paused_at" timestamp with time zone;
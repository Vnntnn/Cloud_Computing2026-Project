ALTER TABLE "refunds" ADD COLUMN "recovery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "recovery_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "recovery_hold" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_recovery_hold_check" CHECK ("refunds"."recovery_hold" in ('exhausted'));
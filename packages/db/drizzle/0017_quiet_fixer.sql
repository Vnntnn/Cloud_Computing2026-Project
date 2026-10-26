ALTER TABLE "notification_outbox" ALTER COLUMN "enrollment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_outbox" ALTER COLUMN "message" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "ticket_mail_outbox" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket_mail_outbox" ADD COLUMN "last_error" text;--> statement-breakpoint
CREATE INDEX "notification_outbox_subject_id_idx" ON "notification_outbox" USING btree ("subject_id");
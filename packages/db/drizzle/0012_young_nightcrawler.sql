CREATE TABLE "ticket_mail_outbox" (
	"ticket_id" uuid PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_mail_outbox_state_check" CHECK ("ticket_mail_outbox"."state" in ('pending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "accepted_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "recovery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "recovery_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "recovery_hold" text;--> statement-breakpoint
ALTER TABLE "ticket_mail_outbox" ADD CONSTRAINT "ticket_mail_outbox_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_mail_outbox_state_idx" ON "ticket_mail_outbox" USING btree ("state","next_attempt_at");--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_accepted_payment_id_payments_id_fk" FOREIGN KEY ("accepted_payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recovery_hold_check" CHECK ("payments"."recovery_hold" in ('over_limit', 'exhausted', 'inconsistent'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_paid_at_check" CHECK ("payments"."status" not in ('paid', 'refunded') or "payments"."paid_at" is not null) NOT VALID;
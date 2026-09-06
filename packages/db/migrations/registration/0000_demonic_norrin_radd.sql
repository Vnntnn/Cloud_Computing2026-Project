CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"event_title" text NOT NULL,
	"event_capacity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_event_user_unique" UNIQUE("event_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "tickets_event_id_idx" ON "tickets" USING btree ("event_id");
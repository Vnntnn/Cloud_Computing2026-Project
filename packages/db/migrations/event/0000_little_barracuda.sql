CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"venue" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"cover_key" text,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_capacity_positive" CHECK ("events"."capacity" > 0)
);

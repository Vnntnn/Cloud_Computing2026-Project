CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name"),
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "event_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"alt_text" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_images_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "event_images_event_position_unique" UNIQUE("event_id","position"),
	CONSTRAINT "event_images_position_nonnegative" CHECK ("event_images"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"venue_id" uuid,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"sales_start_at" timestamp with time zone NOT NULL,
	"sales_end_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"refund_percent" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_capacity_positive" CHECK ("events"."capacity" > 0),
	CONSTRAINT "events_time_valid" CHECK ("events"."ends_at" > "events"."starts_at"),
	CONSTRAINT "events_sales_window_valid" CHECK ("events"."sales_end_at" > "events"."sales_start_at"),
	CONSTRAINT "events_refund_percent_valid" CHECK ("events"."refund_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"quota" integer NOT NULL,
	"max_per_order" integer DEFAULT 10 NOT NULL,
	"sales_start_at" timestamp with time zone,
	"sales_end_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_types_event_name_unique" UNIQUE("event_id","name"),
	CONSTRAINT "ticket_types_price_nonnegative" CHECK ("ticket_types"."price" >= 0),
	CONSTRAINT "ticket_types_quota_positive" CHECK ("ticket_types"."quota" > 0),
	CONSTRAINT "ticket_types_max_per_order_positive" CHECK ("ticket_types"."max_per_order" > 0),
	CONSTRAINT "ticket_types_sales_window_valid" CHECK ("ticket_types"."sales_start_at" is null or "ticket_types"."sales_end_at" is null or "ticket_types"."sales_end_at" > "ticket_types"."sales_start_at")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"province" text NOT NULL,
	"postal_code" text,
	"capacity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_capacity_positive" CHECK ("venues"."capacity" is null or "venues"."capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "event_change_logs" ADD CONSTRAINT "event_change_logs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_images" ADD CONSTRAINT "event_images_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_change_logs_event_created_idx" ON "event_change_logs" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "events_owner_idx" ON "events" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "events_status_starts_idx" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "ticket_types_event_idx" ON "ticket_types" USING btree ("event_id");
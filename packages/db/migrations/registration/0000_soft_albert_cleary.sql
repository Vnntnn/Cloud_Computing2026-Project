CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid,
	"event_id" uuid,
	"scanner_id" text NOT NULL,
	"result" text NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"resource_id" uuid,
	"response_status" integer,
	"response_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_scope_key_unique" UNIQUE("scope","key")
);
--> statement-breakpoint
CREATE TABLE "order_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"ticket_type_name" text NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	CONSTRAINT "order_items_order_ticket_type_unique" UNIQUE("order_id","ticket_type_id"),
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_unit_price_nonnegative" CHECK ("order_items"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"event_title" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"currency" text DEFAULT 'THB' NOT NULL,
	"refund_percent" integer DEFAULT 100 NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_subtotal_nonnegative" CHECK ("orders"."subtotal" >= 0),
	CONSTRAINT "orders_total_nonnegative" CHECK ("orders"."total" >= 0),
	CONSTRAINT "orders_refund_percent_valid" CHECK ("orders"."refund_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "ticket_inventory" (
	"ticket_type_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"total_quota" integer NOT NULL,
	"reserved_count" integer DEFAULT 0 NOT NULL,
	"sold_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_quota_positive" CHECK ("ticket_inventory"."total_quota" > 0),
	CONSTRAINT "inventory_reserved_nonnegative" CHECK ("ticket_inventory"."reserved_count" >= 0),
	CONSTRAINT "inventory_sold_nonnegative" CHECK ("ticket_inventory"."sold_count" >= 0),
	CONSTRAINT "inventory_within_quota" CHECK ("ticket_inventory"."reserved_count" + "ticket_inventory"."sold_count" <= "ticket_inventory"."total_quota")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"event_title" text NOT NULL,
	"ticket_type_name" text NOT NULL,
	"status" text DEFAULT 'VALID' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_audit_logs" ADD CONSTRAINT "order_audit_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_ins_event_created_idx" ON "check_ins" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "order_audit_order_created_idx" ON "order_audit_logs" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_user_created_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_expiry_idx" ON "orders" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "ticket_inventory_event_idx" ON "ticket_inventory" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "tickets_user_issued_idx" ON "tickets" USING btree ("user_id","issued_at");--> statement-breakpoint
CREATE INDEX "tickets_event_idx" ON "tickets" USING btree ("event_id");
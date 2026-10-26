ALTER TABLE "event_categories" ADD COLUMN "name_en" text;--> statement-breakpoint
-- the category every migration-created database starts with (0004) gets its English name
UPDATE "event_categories" SET "name_en" = 'General' WHERE "slug" = 'general' AND "name_en" IS NULL;

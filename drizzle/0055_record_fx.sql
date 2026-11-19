ALTER TABLE "records" ADD COLUMN "fx_role" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "fx_link_id" integer;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "original_amount" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "original_currency" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "fx_rate" numeric(20, 8);
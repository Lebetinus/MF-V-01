ALTER TABLE "finance_notes" ADD COLUMN "format" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_notes" ADD COLUMN "sheet" jsonb;
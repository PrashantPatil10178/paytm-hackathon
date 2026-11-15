ALTER TABLE "rai_calls" ADD COLUMN "purpose" text DEFAULT 'sales' NOT NULL;--> statement-breakpoint
ALTER TABLE "rai_calls" ADD COLUMN "customer_id" integer;--> statement-breakpoint
ALTER TABLE "rai_calls" ADD COLUMN "ticket_id" integer;--> statement-breakpoint
ALTER TABLE "rai_calls" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "rai_calls" ADD COLUMN "run_id" integer;--> statement-breakpoint
ALTER TABLE "rai_calls" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "rai_calls" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "rai_calls" ADD COLUMN "continued_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "rai_calls_ticket_id_index" ON "rai_calls" USING btree ("ticket_id");
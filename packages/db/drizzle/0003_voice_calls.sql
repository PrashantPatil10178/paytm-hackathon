CREATE TABLE "voice_calls" (
	"interaction_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"caller_phone" text DEFAULT '' NOT NULL,
	"line_phone" text DEFAULT '' NOT NULL,
	"customer_id" integer,
	"ticket_id" integer,
	"turns" integer DEFAULT 0 NOT NULL,
	"duration" real,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variables" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_calls_started_at_index" ON "voice_calls" USING btree ("started_at");
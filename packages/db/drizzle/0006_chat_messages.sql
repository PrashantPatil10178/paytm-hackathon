CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"customer_id" integer NOT NULL,
	"channel_id" text DEFAULT 'shopkart' NOT NULL,
	"sender" text NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"ticket_id" integer,
	"ask" jsonb,
	"answer" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_messages_session_id_index" ON "chat_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "chat_messages_ticket_id_index" ON "chat_messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "chat_messages_created_at_index" ON "chat_messages" USING btree ("created_at");
CREATE TABLE "board_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"tag" text DEFAULT '' NOT NULL,
	"column" text DEFAULT 'todo' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rai_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'sarvam' NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"contact_id" integer,
	"deal_id" integer,
	"external_id" text,
	"outcome" text,
	"lead_score" text,
	"extracted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"duration_s" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rai_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rai_calls_external_id_index" ON "rai_calls" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "rai_calls_deal_id_index" ON "rai_calls" USING btree ("deal_id");
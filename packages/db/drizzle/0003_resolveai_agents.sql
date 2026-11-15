CREATE TABLE "rai_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"session_id" text NOT NULL,
	"customer_id" integer NOT NULL,
	"ticket_id" integer,
	"kind" text DEFAULT 'request' NOT NULL,
	"message" text NOT NULL,
	"intent" text,
	"level" text,
	"level_reason" text,
	"handled_by" text,
	"status" text DEFAULT 'triaging' NOT NULL,
	"plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rai_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"agent" text NOT NULL,
	"step" text NOT NULL,
	"tool" text NOT NULL,
	"result" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rai_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"ticket_id" integer NOT NULL,
	"action" text NOT NULL,
	"order_id" integer NOT NULL,
	"amount" double precision NOT NULL,
	"reason" text NOT NULL,
	"summary" text NOT NULL,
	"suggestion" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rai_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"token_hash" text,
	"token_hint" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rai_connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"base_url" text NOT NULL,
	"token" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "rai_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"ticket_id" integer,
	"customer_id" integer NOT NULL,
	"intent" text NOT NULL,
	"level" text NOT NULL,
	"handled_by" text NOT NULL,
	"problem" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolution" text NOT NULL,
	"outcome" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "level" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "handled_by" text;--> statement-breakpoint
ALTER TABLE "rai_steps" ADD CONSTRAINT "rai_steps_run_id_rai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."rai_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rai_approvals" ADD CONSTRAINT "rai_approvals_run_id_rai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."rai_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rai_runs_ticket_id_index" ON "rai_runs" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "rai_runs_session_id_index" ON "rai_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "rai_steps_run_id_index" ON "rai_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "rai_cases_intent_index" ON "rai_cases" USING btree ("intent");
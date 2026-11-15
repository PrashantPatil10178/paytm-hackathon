CREATE TABLE "policies" (
	"code" text PRIMARY KEY NOT NULL,
	"area" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"customer_text" text NOT NULL,
	"owner" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_rules" (
	"code" text PRIMARY KEY NOT NULL,
	"policy_code" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effect" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approver" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_policy_code_policies_code_fk" FOREIGN KEY ("policy_code") REFERENCES "public"."policies"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_rules_policy_code_index" ON "policy_rules" USING btree ("policy_code");--> statement-breakpoint
CREATE INDEX "policy_rules_effect_index" ON "policy_rules" USING btree ("effect");
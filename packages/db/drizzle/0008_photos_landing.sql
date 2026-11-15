CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"session_id" text,
	"chat_message_id" integer,
	"ticket_id" integer,
	"comment_id" integer,
	"order_id" integer,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer DEFAULT 0 NOT NULL,
	"height" integer DEFAULT 0 NOT NULL,
	"sha256" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "headline" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "pitch" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "landing_visits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "attachments_ticket_id_index" ON "attachments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "attachments_session_id_index" ON "attachments" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "attachments_sha256_index" ON "attachments" USING btree ("sha256");--> statement-breakpoint
UPDATE "campaigns" SET "slug" = 'diwali-bulk-gifting', "headline" = 'Diwali gifts for your whole team, sorted', "pitch" = 'Branded hampers, sweets boxes and gift sets from ShopKart, packed with your logo and delivered to every office or home address in India. Bulk pricing from 50 boxes.' WHERE "name" = 'Diwali bulk gifting' AND "slug" = '';--> statement-breakpoint
UPDATE "campaigns" SET "slug" = 'gst-billing-for-restaurants', "headline" = 'GST billing that keeps up with a busy kitchen', "pitch" = 'ShopKart''s billing setup gives restaurants GST invoices, table and takeaway orders and daily reports in one place, set up by our team in a day.' WHERE "name" = 'GST billing for restaurants' AND "slug" = '';--> statement-breakpoint
UPDATE "campaigns" SET "slug" = 'upi-payments-for-d2c-stores', "headline" = 'Take UPI payments on your store this week', "pitch" = 'Paytm-powered UPI, cards and payment links for direct-to-consumer brands, with instant settlement reports. We set it up with you.' WHERE "name" = 'UPI payments for D2C stores' AND "slug" = '';--> statement-breakpoint
UPDATE "campaigns" SET "slug" = 'wholesale-catalogue-mailer', "headline" = 'ShopKart''s wholesale catalogue, at trade prices', "pitch" = 'Stock up on ShopKart''s best sellers at wholesale prices: audio, wearables, bags and home goods, with GST invoices and doorstep delivery.' WHERE "name" = 'Wholesale catalogue mailer' AND "slug" = '';--> statement-breakpoint
UPDATE "campaigns" SET "slug" = 'campaign-' || "id" WHERE "slug" = '';

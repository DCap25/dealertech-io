CREATE TABLE "demo_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"dealership_name" text NOT NULL,
	"role" text,
	"rooftops" integer,
	"dms" text,
	"message" text,
	"source" text,
	"referrer" text,
	"contacted" boolean DEFAULT false NOT NULL,
	"contacted_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "demo_requests_created_idx" ON "demo_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "demo_requests_email_idx" ON "demo_requests" USING btree ("email");
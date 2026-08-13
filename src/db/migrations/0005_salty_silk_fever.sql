CREATE TYPE "public"."opportunity_outcome" AS ENUM('ACCEPTED', 'DECLINED', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "prep_sheet_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"appointment_id" uuid,
	"advisor_id" uuid,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"opportunity_key" text NOT NULL,
	"opportunity_type" text NOT NULL,
	"title" text NOT NULL,
	"urgency" text NOT NULL,
	"likely_payer" "payer" NOT NULL,
	"estimated_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"customer_out_of_pocket" numeric(10, 2) DEFAULT '0' NOT NULL,
	"outcome" "opportunity_outcome" NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prep_sheet_outcomes" ADD CONSTRAINT "prep_sheet_outcomes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_sheet_outcomes" ADD CONSTRAINT "prep_sheet_outcomes_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_sheet_outcomes" ADD CONSTRAINT "prep_sheet_outcomes_advisor_id_users_id_fk" FOREIGN KEY ("advisor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_sheet_outcomes" ADD CONSTRAINT "prep_sheet_outcomes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_sheet_outcomes" ADD CONSTRAINT "prep_sheet_outcomes_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prep_sheet_outcomes_advisor_idx" ON "prep_sheet_outcomes" USING btree ("store_id","advisor_id","decided_at");--> statement-breakpoint
CREATE INDEX "prep_sheet_outcomes_appointment_idx" ON "prep_sheet_outcomes" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prep_sheet_outcomes_unique_idx" ON "prep_sheet_outcomes" USING btree ("appointment_id","opportunity_key");
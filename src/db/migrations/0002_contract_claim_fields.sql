ALTER TABLE "contracts" ADD COLUMN "requires_prior_authorization" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "claim_phone" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "claim_portal_url" text;
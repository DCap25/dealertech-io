CREATE TYPE "public"."appointment_source" AS ENUM('PHONE', 'WALK_IN', 'ONLINE', 'BDC', 'ADVISOR', 'DMS_SYNC', 'CAMPAIGN', 'RECALL');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_SERVICE', 'READY', 'DELIVERED', 'NO_SHOW', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."cadence_trigger" AS ENUM('POST_VISIT_THANK_YOU', 'CSI_PRE_EMPTION', 'DECLINED_SERVICE_FOLLOW_UP', 'MAINTENANCE_DUE_MILEAGE', 'MAINTENANCE_DUE_TIME', 'OEM_SCHEDULE_INTERVAL', 'PPM_EXPIRING', 'WARRANTY_EXPIRING', 'CONTRACT_EXPIRING', 'OPEN_RECALL', 'STATE_INSPECTION_DUE', 'SEASONAL', 'DORMANT_CUSTOMER', 'MISSED_APPOINTMENT');--> statement-breakpoint
CREATE TYPE "public"."call_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('CONNECTED', 'VOICEMAIL', 'NO_ANSWER', 'BUSY', 'WRONG_NUMBER', 'DISCONNECTED');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."consent_event_type" AS ENUM('GRANTED', 'REVOKED', 'STOP_KEYWORD', 'HELP_KEYWORD', 'BOUNCED', 'COMPLAINED', 'IMPORTED');--> statement-breakpoint
CREATE TYPE "public"."consent_scope" AS ENUM('SMS_TRANSACTIONAL', 'SMS_MARKETING', 'EMAIL_TRANSACTIONAL', 'EMAIL_MARKETING', 'VOICE');--> statement-breakpoint
CREATE TYPE "public"."contact_channel" AS ENUM('SMS', 'EMAIL', 'PHONE', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."contract_source" AS ENUM('MANUAL', 'CSV_IMPORT', 'PDF_EXTRACTION', 'DMS');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('ACTIVE', 'EXPIRED', 'CANCELLED', 'EXHAUSTED', 'PENDING_VERIFICATION');--> statement-breakpoint
CREATE TYPE "public"."deductible_type" AS ENUM('PER_VISIT', 'PER_REPAIR', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."dms_vendor" AS ENUM('CDK', 'REYNOLDS', 'TEKION', 'DEALERTRACK', 'PBS', 'AUTOMATE', 'DEALERBUILT', 'XTIME', 'MYKAARMA', 'DEALER_FX', 'CSV', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('GREEN', 'YELLOW', 'RED', 'NOT_CHECKED');--> statement-breakpoint
CREATE TYPE "public"."measurement_unit" AS ENUM('THIRTY_SECONDS', 'MILLIMETERS', 'PERCENT', 'VOLTS', 'CCA', 'PSI', 'INCHES');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('SMS', 'EMAIL', 'VOICE', 'IN_APP');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNDELIVERABLE', 'BLOCKED_NO_CONSENT', 'BLOCKED_QUIET_HOURS');--> statement-breakpoint
CREATE TYPE "public"."pay_type" AS ENUM('CUSTOMER_PAY', 'WARRANTY', 'INTERNAL');--> statement-breakpoint
CREATE TYPE "public"."payer" AS ENUM('OEM_RECALL', 'PPM', 'TIRE_WHEEL', 'OEM_WARRANTY', 'VSC', 'GOODWILL', 'CUSTOMER_PAY');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('VSC', 'PPM', 'TIRE_WHEEL', 'KEY', 'DENT', 'WINDSHIELD', 'APPEARANCE', 'THEFT');--> statement-breakpoint
CREATE TYPE "public"."ro_line_status" AS ENUM('RECOMMENDED', 'PENDING_APPROVAL', 'APPROVED', 'DECLINED', 'IN_PROGRESS', 'COMPLETE');--> statement-breakpoint
CREATE TYPE "public"."ro_status" AS ENUM('OPEN', 'DISPATCHED', 'IN_PROGRESS', 'WAITING_PARTS', 'WAITING_APPROVAL', 'WAITING_SUBLET', 'COMPLETE', 'CLOSED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."sync_direction" AS ENUM('PULL', 'PUSH', 'BIDIRECTIONAL');--> statement-breakpoint
CREATE TYPE "public"."sync_entity" AS ENUM('CUSTOMER', 'VEHICLE', 'APPOINTMENT', 'REPAIR_ORDER', 'RO_LINE', 'INSPECTION', 'CONTRACT', 'OP_CODE', 'TECHNICIAN');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."task_outcome" AS ENUM('APPOINTMENT_SET', 'CALLBACK_REQUESTED', 'NOT_INTERESTED', 'NO_ANSWER', 'LEFT_VOICEMAIL', 'WRONG_NUMBER', 'SOLD_ELSEWHERE', 'VEHICLE_SOLD', 'DO_NOT_CONTACT');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SNOOZED', 'DISMISSED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."tier_type" AS ENUM('EXCLUSIONARY', 'INCLUSIONARY');--> statement-breakpoint
CREATE TYPE "public"."transport_type" AS ENUM('WAITER', 'DROP_OFF', 'LOANER', 'RENTAL', 'SHUTTLE', 'PICKUP_DELIVERY', 'TOW_IN');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADVISOR', 'BDC', 'TECHNICIAN', 'DISPATCHER', 'PARTS', 'CASHIER', 'SERVICE_MANAGER', 'FIXED_OPS_DIRECTOR', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."wheel_position" AS ENUM('LF', 'RF', 'LR', 'RR', 'SPARE');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"changes" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"franchise_make" text,
	"address_line1" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"phone" text,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"labor_rate" numeric(10, 2) DEFAULT '0' NOT NULL,
	"warranty_labor_rate" numeric(10, 2),
	"parts_tax_rate" numeric(6, 5) DEFAULT '0' NOT NULL,
	"labor_tax_rate" numeric(6, 5) DEFAULT '0' NOT NULL,
	"quiet_hours_start" integer DEFAULT 8 NOT NULL,
	"quiet_hours_end" integer DEFAULT 21 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_org_slug_unique" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
CREATE TABLE "user_store_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"dms_operator_code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_store_role_unique" UNIQUE("user_id","store_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"phone" text,
	"avatar_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"is_original_owner" boolean DEFAULT false NOT NULL,
	"sold_by_store" boolean DEFAULT false NOT NULL,
	"purchased_at" date,
	"is_current" boolean DEFAULT true NOT NULL,
	"relinquished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"first_name" text,
	"last_name" text,
	"company_name" text,
	"email" text,
	"mobile_phone" text,
	"home_phone" text,
	"work_phone" text,
	"address_line1" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"preferred_channel" "contact_channel" DEFAULT 'SMS' NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"sms_consent" boolean DEFAULT false NOT NULL,
	"sms_marketing_consent" boolean DEFAULT false NOT NULL,
	"email_consent" boolean DEFAULT false NOT NULL,
	"email_marketing_consent" boolean DEFAULT false NOT NULL,
	"do_not_call" boolean DEFAULT false NOT NULL,
	"lifetime_spend" numeric(12, 2) DEFAULT '0' NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"first_visit_at" timestamp with time zone,
	"last_visit_at" timestamp with time zone,
	"last_csi_score" integer,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mileage_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"mileage" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"vin" text NOT NULL,
	"vin_valid" boolean DEFAULT false NOT NULL,
	"make" text NOT NULL,
	"model" text,
	"model_year" integer NOT NULL,
	"trim" text,
	"body_class" text,
	"drive_type" text,
	"engine_description" text,
	"fuel_type" text,
	"is_hybrid_or_ev" boolean DEFAULT false NOT NULL,
	"color" text,
	"license_plate" text,
	"license_state" text,
	"in_service_date" date,
	"current_mileage" integer,
	"mileage_as_of" timestamp with time zone,
	"avg_miles_per_day" numeric(8, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_store_vin_unique" UNIQUE("store_id","vin")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid,
	"vehicle_id" uuid,
	"advisor_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"promised_at" timestamp with time zone,
	"estimated_minutes" integer,
	"status" "appointment_status" DEFAULT 'SCHEDULED' NOT NULL,
	"source" "appointment_source" DEFAULT 'PHONE' NOT NULL,
	"transport_type" "transport_type" DEFAULT 'DROP_OFF' NOT NULL,
	"customer_concerns" text,
	"internal_notes" text,
	"projected_mileage" integer,
	"arrived_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coverage_determinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"repair_order_id" uuid,
	"ro_line_id" uuid,
	"component_group_key" text,
	"concern_text" text NOT NULL,
	"determined_payer" "payer" NOT NULL,
	"confidence" "confidence" NOT NULL,
	"customer_out_of_pocket" numeric(10, 2),
	"covered_amount" numeric(10, 2),
	"warranty_term_name" text,
	"reasoning" text,
	"required_actions" text,
	"advisor_override_payer" "payer",
	"override_reason" text,
	"actual_payer" "payer",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "declined_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"repair_order_id" uuid,
	"ro_line_id" uuid,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"description" text NOT NULL,
	"component_group_key" text,
	"quoted_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"declined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decline_reason" text,
	"mileage_at_decline" integer,
	"resolved_at" timestamp with time zone,
	"resolved_by_ro_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"inspection_item_id" uuid,
	"approved" boolean NOT NULL,
	"amount" numeric(10, 2),
	"decline_reason" text,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_via" text DEFAULT 'WEB' NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"signature_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"label" text NOT NULL,
	"component_group_key" text,
	"status" "inspection_status" DEFAULT 'NOT_CHECKED' NOT NULL,
	"measurement_value" numeric(10, 2),
	"measurement_unit" "measurement_unit",
	"wheel_position" "wheel_position",
	"technician_notes" text,
	"photo_urls" text,
	"recommended_op_code_id" uuid,
	"estimated_amount" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"repair_order_id" uuid,
	"vehicle_id" uuid NOT NULL,
	"technician_id" uuid,
	"mileage" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"share_token" text,
	"share_expires_at" timestamp with time zone,
	"viewed_by_customer_at" timestamp with time zone,
	"video_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspections_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "op_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"component_group_key" text,
	"category" text,
	"labor_hours" numeric(6, 2),
	"labor_amount" numeric(10, 2),
	"parts_amount" numeric(10, 2),
	"is_maintenance" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "op_codes_store_code_unique" UNIQUE("store_id","code")
);
--> statement-breakpoint
CREATE TABLE "repair_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"appointment_id" uuid,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"advisor_id" uuid,
	"ro_number" text NOT NULL,
	"status" "ro_status" DEFAULT 'OPEN' NOT NULL,
	"mileage_in" integer,
	"mileage_out" integer,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"customer_pay_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"warranty_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"internal_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"labor_gross" numeric(12, 2) DEFAULT '0' NOT NULL,
	"parts_gross" numeric(12, 2) DEFAULT '0' NOT NULL,
	"hours_sold" numeric(8, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_orders_store_number_unique" UNIQUE("store_id","ro_number")
);
--> statement-breakpoint
CREATE TABLE "ro_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"repair_order_id" uuid NOT NULL,
	"op_code_id" uuid,
	"technician_id" uuid,
	"line_number" integer NOT NULL,
	"description" text NOT NULL,
	"component_group_key" text,
	"pay_type" "pay_type" DEFAULT 'CUSTOMER_PAY' NOT NULL,
	"status" "ro_line_status" DEFAULT 'RECOMMENDED' NOT NULL,
	"labor_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"labor_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"parts_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"customer_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"complaint" text,
	"cause" text,
	"correction" text,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_coverage_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"component_group_key" text NOT NULL,
	"is_covered" boolean NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_coverage_unique" UNIQUE("contract_id","component_group_key")
);
--> statement-breakpoint
CREATE TABLE "contract_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"admin_company" text NOT NULL,
	"product_type" "product_type" NOT NULL,
	"product_name" text NOT NULL,
	"tier_type" "tier_type" DEFAULT 'EXCLUSIONARY' NOT NULL,
	"claim_phone" text,
	"claim_portal_url" text,
	"claim_procedure_notes" text,
	"requires_prior_authorization" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"customer_id" uuid,
	"product_id" uuid,
	"product_type" "product_type" NOT NULL,
	"admin_company" text NOT NULL,
	"contract_number" text,
	"coverage_tier" text,
	"tier_type" "tier_type" DEFAULT 'EXCLUSIONARY' NOT NULL,
	"purchase_date" date NOT NULL,
	"purchase_mileage" integer,
	"term_months" integer,
	"term_miles" integer,
	"expiration_date" date,
	"expiration_miles" integer,
	"deductible_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"deductible_type" "deductible_type" DEFAULT 'PER_VISIT' NOT NULL,
	"minimum_tread_depth_32nds" integer,
	"per_tire_limit" numeric(10, 2),
	"status" "contract_status" DEFAULT 'ACTIVE' NOT NULL,
	"source" "contract_source" DEFAULT 'MANUAL' NOT NULL,
	"extraction_confidence" "confidence",
	"document_url" text,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prepaid_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"component_group_key" text NOT NULL,
	"label" text NOT NULL,
	"total_allowed" integer NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prepaid_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"repair_order_id" uuid,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mileage" integer,
	"amount" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_recalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"campaign_number" text NOT NULL,
	"component" text,
	"component_group_keys" text,
	"summary" text,
	"remedy" text,
	"park_it" boolean DEFAULT false NOT NULL,
	"park_outside" boolean DEFAULT false NOT NULL,
	"is_candidate" boolean DEFAULT true NOT NULL,
	"verified_open_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_recalls_unique" UNIQUE("vehicle_id","campaign_number")
);
--> statement-breakpoint
CREATE TABLE "consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"event_type" "consent_event_type" NOT NULL,
	"scope" "consent_scope" NOT NULL,
	"channel_address" text NOT NULL,
	"source" text NOT NULL,
	"disclosure_text" text,
	"captured_by_user_id" uuid,
	"ip_address" text,
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"channel" "message_channel" NOT NULL,
	"customer_address" text NOT NULL,
	"store_address" text,
	"assigned_user_id" uuid,
	"is_open" boolean DEFAULT true NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_unique_thread" UNIQUE("store_id","customer_id","channel","customer_address")
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"channel" "message_channel" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"is_marketing" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_store_key_unique" UNIQUE("store_id","key")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"channel" "message_channel" NOT NULL,
	"status" "message_status" DEFAULT 'QUEUED' NOT NULL,
	"body" text NOT NULL,
	"subject" text,
	"media_urls" text,
	"sent_by_user_id" uuid,
	"is_automated" boolean DEFAULT false NOT NULL,
	"authorizing_consent_event_id" uuid,
	"suppression_reason" text,
	"appointment_id" uuid,
	"repair_order_id" uuid,
	"inspection_id" uuid,
	"provider_message_id" text,
	"provider_error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cadence_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" "cadence_trigger" NOT NULL,
	"offset_days" integer DEFAULT 0 NOT NULL,
	"offset_miles" integer,
	"assign_to_role" text,
	"channel" "message_channel",
	"template_id" uuid,
	"talk_track" text,
	"auto_send" boolean DEFAULT false NOT NULL,
	"cooldown_days" integer DEFAULT 30 NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cadence_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"cadence_rule_id" uuid,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"trigger" "cadence_trigger" NOT NULL,
	"source_repair_order_id" uuid,
	"source_declined_service_id" uuid,
	"source_appointment_id" uuid,
	"title" text NOT NULL,
	"detail" text,
	"talk_track" text,
	"estimated_value" numeric(10, 2),
	"priority" integer DEFAULT 100 NOT NULL,
	"assigned_user_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"status" "task_status" DEFAULT 'PENDING' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"outcome" "task_outcome",
	"outcome_notes" text,
	"resulting_appointment_id" uuid,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid,
	"vehicle_id" uuid,
	"user_id" uuid,
	"cadence_task_id" uuid,
	"direction" "call_direction" NOT NULL,
	"outcome" "call_outcome",
	"phone_number" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_seconds" integer,
	"notes" text,
	"recording_url" text,
	"recording_consent" boolean DEFAULT false NOT NULL,
	"resulting_appointment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"suppression_reason" text,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"resulting_appointment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_targets_unique" UNIQUE("campaign_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"channel" "message_channel" NOT NULL,
	"template_id" uuid,
	"is_marketing" boolean DEFAULT true NOT NULL,
	"audience_filter" text,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"target_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"suppressed_count" integer DEFAULT 0 NOT NULL,
	"appointment_count" integer DEFAULT 0 NOT NULL,
	"attributed_revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"user_id" uuid,
	"body" text NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"make" text NOT NULL,
	"model" text,
	"model_year_from" integer,
	"model_year_to" integer,
	"interval_miles" integer,
	"interval_months" integer,
	"description" text NOT NULL,
	"op_code_keys" text,
	"component_group_keys" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dms_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"vendor" "dms_vendor" NOT NULL,
	"display_name" text NOT NULL,
	"external_store_id" text,
	"credential_ref" text,
	"direction" "sync_direction" DEFAULT 'PULL' NOT NULL,
	"enabled_entities" text,
	"sync_interval_minutes" integer DEFAULT 60 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity" "sync_entity" NOT NULL,
	"internal_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"last_payload_hash" text,
	"last_pulled_at" timestamp with time zone,
	"last_pushed_at" timestamp with time zone,
	"has_conflict" boolean DEFAULT false NOT NULL,
	"conflict_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_refs_external_unique" UNIQUE("connection_id","entity","external_id"),
	CONSTRAINT "external_refs_internal_unique" UNIQUE("connection_id","entity","internal_id")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"entity" "sync_entity" NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text,
	"column_mapping" text,
	"status" "sync_status" DEFAULT 'PENDING' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"error_report" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity" "sync_entity" NOT NULL,
	"direction" "sync_direction" NOT NULL,
	"status" "sync_status" DEFAULT 'PENDING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"records_read" integer DEFAULT 0 NOT NULL,
	"records_created" integer DEFAULT 0 NOT NULL,
	"records_updated" integer DEFAULT 0 NOT NULL,
	"records_skipped" integer DEFAULT 0 NOT NULL,
	"records_failed" integer DEFAULT 0 NOT NULL,
	"cursor" text,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_store_roles" ADD CONSTRAINT "user_store_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_store_roles" ADD CONSTRAINT "user_store_roles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mileage_readings" ADD CONSTRAINT "mileage_readings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mileage_readings" ADD CONSTRAINT "mileage_readings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_advisor_id_users_id_fk" FOREIGN KEY ("advisor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_determinations" ADD CONSTRAINT "coverage_determinations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_determinations" ADD CONSTRAINT "coverage_determinations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_determinations" ADD CONSTRAINT "coverage_determinations_repair_order_id_repair_orders_id_fk" FOREIGN KEY ("repair_order_id") REFERENCES "public"."repair_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_determinations" ADD CONSTRAINT "coverage_determinations_ro_line_id_ro_lines_id_fk" FOREIGN KEY ("ro_line_id") REFERENCES "public"."ro_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declined_services" ADD CONSTRAINT "declined_services_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declined_services" ADD CONSTRAINT "declined_services_repair_order_id_repair_orders_id_fk" FOREIGN KEY ("repair_order_id") REFERENCES "public"."repair_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declined_services" ADD CONSTRAINT "declined_services_ro_line_id_ro_lines_id_fk" FOREIGN KEY ("ro_line_id") REFERENCES "public"."ro_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declined_services" ADD CONSTRAINT "declined_services_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declined_services" ADD CONSTRAINT "declined_services_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declined_services" ADD CONSTRAINT "declined_services_resolved_by_ro_id_repair_orders_id_fk" FOREIGN KEY ("resolved_by_ro_id") REFERENCES "public"."repair_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_approvals" ADD CONSTRAINT "inspection_approvals_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_approvals" ADD CONSTRAINT "inspection_approvals_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_approvals" ADD CONSTRAINT "inspection_approvals_inspection_item_id_inspection_items_id_fk" FOREIGN KEY ("inspection_item_id") REFERENCES "public"."inspection_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_recommended_op_code_id_op_codes_id_fk" FOREIGN KEY ("recommended_op_code_id") REFERENCES "public"."op_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_repair_order_id_repair_orders_id_fk" FOREIGN KEY ("repair_order_id") REFERENCES "public"."repair_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_codes" ADD CONSTRAINT "op_codes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_advisor_id_users_id_fk" FOREIGN KEY ("advisor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ro_lines" ADD CONSTRAINT "ro_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ro_lines" ADD CONSTRAINT "ro_lines_repair_order_id_repair_orders_id_fk" FOREIGN KEY ("repair_order_id") REFERENCES "public"."repair_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ro_lines" ADD CONSTRAINT "ro_lines_op_code_id_op_codes_id_fk" FOREIGN KEY ("op_code_id") REFERENCES "public"."op_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ro_lines" ADD CONSTRAINT "ro_lines_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_coverage_items" ADD CONSTRAINT "contract_coverage_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_coverage_items" ADD CONSTRAINT "contract_coverage_items_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_products" ADD CONSTRAINT "contract_products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_product_id_contract_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."contract_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_entitlements" ADD CONSTRAINT "prepaid_entitlements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_entitlements" ADD CONSTRAINT "prepaid_entitlements_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_entitlements" ADD CONSTRAINT "prepaid_entitlements_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_redemptions" ADD CONSTRAINT "prepaid_redemptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_redemptions" ADD CONSTRAINT "prepaid_redemptions_entitlement_id_prepaid_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."prepaid_entitlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_redemptions" ADD CONSTRAINT "prepaid_redemptions_repair_order_id_repair_orders_id_fk" FOREIGN KEY ("repair_order_id") REFERENCES "public"."repair_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_recalls" ADD CONSTRAINT "vehicle_recalls_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_recalls" ADD CONSTRAINT "vehicle_recalls_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_captured_by_user_id_users_id_fk" FOREIGN KEY ("captured_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_authorizing_consent_event_id_consent_events_id_fk" FOREIGN KEY ("authorizing_consent_event_id") REFERENCES "public"."consent_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_repair_order_id_repair_orders_id_fk" FOREIGN KEY ("repair_order_id") REFERENCES "public"."repair_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_rules" ADD CONSTRAINT "cadence_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_rules" ADD CONSTRAINT "cadence_rules_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_tasks" ADD CONSTRAINT "cadence_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_tasks" ADD CONSTRAINT "cadence_tasks_cadence_rule_id_cadence_rules_id_fk" FOREIGN KEY ("cadence_rule_id") REFERENCES "public"."cadence_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_tasks" ADD CONSTRAINT "cadence_tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_tasks" ADD CONSTRAINT "cadence_tasks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_tasks" ADD CONSTRAINT "cadence_tasks_source_repair_order_id_repair_orders_id_fk" FOREIGN KEY ("source_repair_order_id") REFERENCES "public"."repair_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_tasks" ADD CONSTRAINT "cadence_tasks_source_declined_service_id_declined_services_id_fk" FOREIGN KEY ("source_declined_service_id") REFERENCES "public"."declined_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_tasks" ADD CONSTRAINT "cadence_tasks_source_appointment_id_appointments_id_fk" FOREIGN KEY ("source_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_tasks" ADD CONSTRAINT "cadence_tasks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_tasks" ADD CONSTRAINT "cadence_tasks_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_tasks" ADD CONSTRAINT "cadence_tasks_resulting_appointment_id_appointments_id_fk" FOREIGN KEY ("resulting_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_cadence_task_id_cadence_tasks_id_fk" FOREIGN KEY ("cadence_task_id") REFERENCES "public"."cadence_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_resulting_appointment_id_appointments_id_fk" FOREIGN KEY ("resulting_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_resulting_appointment_id_appointments_id_fk" FOREIGN KEY ("resulting_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms_connections" ADD CONSTRAINT "dms_connections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_connection_id_dms_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."dms_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_dms_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."dms_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_store_created_idx" ON "audit_log" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "stores_org_idx" ON "stores" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "user_store_roles_store_idx" ON "user_store_roles" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "user_store_roles_user_idx" ON "user_store_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "customer_vehicles_customer_idx" ON "customer_vehicles" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_vehicles_vehicle_idx" ON "customer_vehicles" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "customer_vehicles_store_current_idx" ON "customer_vehicles" USING btree ("store_id","is_current");--> statement-breakpoint
CREATE INDEX "customers_store_idx" ON "customers" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "customers_store_lastname_idx" ON "customers" USING btree ("store_id","last_name");--> statement-breakpoint
CREATE INDEX "customers_store_mobile_idx" ON "customers" USING btree ("store_id","mobile_phone");--> statement-breakpoint
CREATE INDEX "customers_store_email_idx" ON "customers" USING btree ("store_id","email");--> statement-breakpoint
CREATE INDEX "customers_last_visit_idx" ON "customers" USING btree ("store_id","last_visit_at");--> statement-breakpoint
CREATE INDEX "mileage_readings_vehicle_idx" ON "mileage_readings" USING btree ("vehicle_id","recorded_at");--> statement-breakpoint
CREATE INDEX "vehicles_store_idx" ON "vehicles" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "vehicles_vin_idx" ON "vehicles" USING btree ("vin");--> statement-breakpoint
CREATE INDEX "vehicles_make_year_idx" ON "vehicles" USING btree ("make","model_year");--> statement-breakpoint
CREATE INDEX "appointments_store_scheduled_idx" ON "appointments" USING btree ("store_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_store_status_idx" ON "appointments" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "appointments_advisor_idx" ON "appointments" USING btree ("advisor_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_customer_idx" ON "appointments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "appointments_vehicle_idx" ON "appointments" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "coverage_determinations_vehicle_idx" ON "coverage_determinations" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "coverage_determinations_ro_idx" ON "coverage_determinations" USING btree ("repair_order_id");--> statement-breakpoint
CREATE INDEX "coverage_determinations_store_created_idx" ON "coverage_determinations" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "declined_services_customer_idx" ON "declined_services" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "declined_services_vehicle_idx" ON "declined_services" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "declined_open_idx" ON "declined_services" USING btree ("store_id","resolved_at");--> statement-breakpoint
CREATE INDEX "inspection_approvals_inspection_idx" ON "inspection_approvals" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "inspection_approvals_store_idx" ON "inspection_approvals" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "inspection_items_inspection_idx" ON "inspection_items" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "inspection_items_key_idx" ON "inspection_items" USING btree ("item_key");--> statement-breakpoint
CREATE INDEX "inspection_items_store_idx" ON "inspection_items" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "inspections_ro_idx" ON "inspections" USING btree ("repair_order_id");--> statement-breakpoint
CREATE INDEX "inspections_vehicle_idx" ON "inspections" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "inspections_store_idx" ON "inspections" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "op_codes_store_idx" ON "op_codes" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "repair_orders_store_opened_idx" ON "repair_orders" USING btree ("store_id","opened_at");--> statement-breakpoint
CREATE INDEX "repair_orders_customer_idx" ON "repair_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "repair_orders_vehicle_idx" ON "repair_orders" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "repair_orders_advisor_idx" ON "repair_orders" USING btree ("advisor_id","opened_at");--> statement-breakpoint
CREATE INDEX "repair_orders_status_idx" ON "repair_orders" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "ro_lines_ro_idx" ON "ro_lines" USING btree ("repair_order_id");--> statement-breakpoint
CREATE INDEX "ro_lines_store_idx" ON "ro_lines" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "ro_lines_component_idx" ON "ro_lines" USING btree ("component_group_key");--> statement-breakpoint
CREATE INDEX "contract_coverage_contract_idx" ON "contract_coverage_items" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_products_admin_idx" ON "contract_products" USING btree ("admin_company","product_type");--> statement-breakpoint
CREATE INDEX "contract_products_store_idx" ON "contract_products" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "contracts_vehicle_idx" ON "contracts" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "contracts_store_status_idx" ON "contracts" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "contracts_customer_idx" ON "contracts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "contracts_unverified_idx" ON "contracts" USING btree ("store_id","verified_at");--> statement-breakpoint
CREATE INDEX "prepaid_entitlements_vehicle_idx" ON "prepaid_entitlements" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "prepaid_entitlements_expiring_idx" ON "prepaid_entitlements" USING btree ("store_id","expires_on");--> statement-breakpoint
CREATE INDEX "prepaid_redemptions_entitlement_idx" ON "prepaid_redemptions" USING btree ("entitlement_id");--> statement-breakpoint
CREATE INDEX "vehicle_recalls_vehicle_idx" ON "vehicle_recalls" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_recalls_open_idx" ON "vehicle_recalls" USING btree ("store_id","completed_at");--> statement-breakpoint
CREATE INDEX "consent_events_customer_idx" ON "consent_events" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "consent_events_address_idx" ON "consent_events" USING btree ("store_id","channel_address");--> statement-breakpoint
CREATE INDEX "consent_events_scope_idx" ON "consent_events" USING btree ("customer_id","scope","occurred_at");--> statement-breakpoint
CREATE INDEX "conversations_store_open_idx" ON "conversations" USING btree ("store_id","is_open","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_assigned_idx" ON "conversations" USING btree ("assigned_user_id","is_open");--> statement-breakpoint
CREATE INDEX "conversations_customer_idx" ON "conversations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "message_templates_store_idx" ON "message_templates" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_store_created_idx" ON "messages" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_status_idx" ON "messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "messages_provider_idx" ON "messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "messages_ro_idx" ON "messages" USING btree ("repair_order_id");--> statement-breakpoint
CREATE INDEX "cadence_rules_store_trigger_idx" ON "cadence_rules" USING btree ("store_id","trigger");--> statement-breakpoint
CREATE INDEX "cadence_rules_active_idx" ON "cadence_rules" USING btree ("store_id","is_active");--> statement-breakpoint
CREATE INDEX "cadence_tasks_worklist_idx" ON "cadence_tasks" USING btree ("store_id","status","due_at");--> statement-breakpoint
CREATE INDEX "cadence_tasks_assigned_idx" ON "cadence_tasks" USING btree ("assigned_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "cadence_tasks_customer_idx" ON "cadence_tasks" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "cadence_tasks_trigger_idx" ON "cadence_tasks" USING btree ("store_id","trigger");--> statement-breakpoint
CREATE INDEX "call_logs_store_started_idx" ON "call_logs" USING btree ("store_id","started_at");--> statement-breakpoint
CREATE INDEX "call_logs_customer_idx" ON "call_logs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "call_logs_user_idx" ON "call_logs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "campaign_targets_campaign_idx" ON "campaign_targets" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaigns_store_status_idx" ON "campaigns" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "customer_notes_customer_idx" ON "customer_notes" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_notes_pinned_idx" ON "customer_notes" USING btree ("customer_id","is_pinned");--> statement-breakpoint
CREATE INDEX "maintenance_schedules_make_idx" ON "maintenance_schedules" USING btree ("make","model_year_from");--> statement-breakpoint
CREATE INDEX "maintenance_schedules_store_idx" ON "maintenance_schedules" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "dms_connections_store_idx" ON "dms_connections" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "dms_connections_active_idx" ON "dms_connections" USING btree ("is_active","last_sync_at");--> statement-breakpoint
CREATE INDEX "external_refs_internal_idx" ON "external_refs" USING btree ("entity","internal_id");--> statement-breakpoint
CREATE INDEX "external_refs_conflict_idx" ON "external_refs" USING btree ("store_id","has_conflict");--> statement-breakpoint
CREATE INDEX "import_batches_store_idx" ON "import_batches" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_runs_connection_idx" ON "sync_runs" USING btree ("connection_id","started_at");--> statement-breakpoint
CREATE INDEX "sync_runs_store_status_idx" ON "sync_runs" USING btree ("store_id","status");
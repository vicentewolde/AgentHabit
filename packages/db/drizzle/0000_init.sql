CREATE TYPE "public"."chain" AS ENUM('stellar', 'avalanche');--> statement-breakpoint
CREATE TYPE "public"."settle_mode" AS ENUM('dry-run', 'live');--> statement-breakpoint
CREATE TYPE "public"."settlement_outcome" AS ENUM('met', 'missed', 'released_stale');--> statement-breakpoint
CREATE TABLE "link_challenges" (
	"nonce" text PRIMARY KEY NOT NULL,
	"chain" "chain" NOT NULL,
	"address" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"chain" "chain" NOT NULL,
	"address" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"chain" "chain" NOT NULL,
	"contract" text NOT NULL,
	"user" text NOT NULL,
	"week_id" bigint NOT NULL,
	"athlete_id" bigint,
	"amount" text NOT NULL,
	"goal_m" bigint NOT NULL,
	"commit_tx_hash" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_chain_contract_user_week_id_pk" PRIMARY KEY("chain","contract","user","week_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"chain" "chain" NOT NULL,
	"address" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"chain" "chain" NOT NULL,
	"contract" text NOT NULL,
	"user" text NOT NULL,
	"week_id" bigint NOT NULL,
	"outcome" "settlement_outcome" NOT NULL,
	"mode" "settle_mode" NOT NULL,
	"tx_hash" text,
	"reason" text NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_chain_contract_user_week_id_mode_pk" PRIMARY KEY("chain","contract","user","week_id","mode")
);
--> statement-breakpoint
CREATE TABLE "strava_connections" (
	"athlete_id" bigint PRIMARY KEY NOT NULL,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"expires_at" timestamp with time zone,
	"scope" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "strava_reads" (
	"chain" "chain" NOT NULL,
	"contract" text NOT NULL,
	"user" text NOT NULL,
	"week_id" bigint NOT NULL,
	"total_m" bigint NOT NULL,
	"activity_ids" jsonb NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "strava_reads_chain_contract_user_week_id_pk" PRIMARY KEY("chain","contract","user","week_id")
);
--> statement-breakpoint
CREATE TABLE "wallet_links" (
	"chain" "chain" NOT NULL,
	"address" text NOT NULL,
	"athlete_id" bigint NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_links_chain_address_pk" PRIMARY KEY("chain","address")
);
--> statement-breakpoint
CREATE INDEX "positions_week_idx" ON "positions" USING btree ("chain","contract","week_id");--> statement-breakpoint
CREATE INDEX "strava_reads_read_at_idx" ON "strava_reads" USING btree ("read_at");
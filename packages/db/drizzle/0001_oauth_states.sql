CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"chain" "chain" NOT NULL,
	"address" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "garages" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "garage_revisions" (
	"id" text PRIMARY KEY,
	"garage_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

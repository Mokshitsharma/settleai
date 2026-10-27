CREATE TABLE "dead_letters" (
	"id" text PRIMARY KEY NOT NULL,
	"outbox_id" text NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer NOT NULL,
	"last_error" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dead_letters_outbox_id_unique" UNIQUE("outbox_id")
);
--> statement-breakpoint
CREATE TABLE "eval_results" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"scenario_id" text NOT NULL,
	"family" text NOT NULL,
	"pass" boolean NOT NULL,
	"decision" text,
	"latency_ms" double precision,
	"detail_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"git_sha" text NOT NULL,
	"dataset_hash" text NOT NULL,
	"seed" integer NOT NULL,
	"variant" text NOT NULL,
	"llm" text NOT NULL,
	"scenarios" integer NOT NULL,
	"metrics_json" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 6 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "outbox_attempts" CHECK ("outbox_events"."attempts" >= 0 and "outbox_events"."max_attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_results_run_scenario" ON "eval_results" USING btree ("run_id","scenario_id");--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "outbox_events" USING btree ("status","available_at");
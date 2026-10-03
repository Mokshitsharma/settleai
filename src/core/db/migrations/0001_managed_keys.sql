CREATE TABLE "managed_keys" (
	"key_id" text PRIMARY KEY NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"encrypted_private_jwk" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "managed_keys_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
ALTER TABLE "managed_keys" ADD CONSTRAINT "managed_keys_key_id_signing_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."signing_keys"("id") ON DELETE no action ON UPDATE no action;
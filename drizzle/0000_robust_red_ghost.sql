CREATE TABLE "dinners" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"tag" text NOT NULL,
	"label" text NOT NULL,
	"meal" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '',
	"skip" boolean DEFAULT false NOT NULL,
	"skip_reason" text DEFAULT '',
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"amount" real NOT NULL,
	"kind" text DEFAULT 'weekly' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"current_week" integer DEFAULT 1 NOT NULL,
	"last_week_total" real,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"store" text DEFAULT 'fred' NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

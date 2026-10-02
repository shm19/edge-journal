CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`idea_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'before' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `idea_tags` (
	`idea_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`idea_id`, `tag_id`),
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`direction` text NOT NULL,
	`status` text DEFAULT 'taken' NOT NULL,
	`setup_id` integer,
	`entry_timeframe` text,
	`htf_bias` text,
	`regime` text,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`thesis` text DEFAULT '' NOT NULL,
	`invalidation` text DEFAULT '' NOT NULL,
	`skip_reason` text DEFAULT '' NOT NULL,
	`review` text DEFAULT '' NOT NULL,
	`followed_plan` integer,
	`risk_pct` real,
	`fees_usd` real,
	`pnl_usd` real,
	`checklist_state` text DEFAULT '{}' NOT NULL,
	`confidence` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`setup_id`) REFERENCES `setups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `scenario_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scenario_types_name_unique` ON `scenario_types` (`name`);--> statement-breakpoint
CREATE TABLE `scenarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`idea_id` integer NOT NULL,
	`scenario_type_id` integer,
	`is_primary` integer DEFAULT false NOT NULL,
	`entry` real NOT NULL,
	`stop` real NOT NULL,
	`target` real,
	`exit_price` real,
	`exit_reason` text,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scenario_type_id`) REFERENCES `scenario_types`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`rules` text DEFAULT '' NOT NULL,
	`checklist` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'testing' NOT NULL,
	`default_timeframe` text,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `setups_name_unique` ON `setups` (`name`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`group` text DEFAULT 'General' NOT NULL,
	`color` text DEFAULT '#64748b' NOT NULL
);

CREATE TABLE `idea_mistakes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`idea_id` integer NOT NULL,
	`mistake_type_id` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`cost_r` real,
	`scenario_id` integer,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mistake_type_id`) REFERENCES `mistake_types`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scenario_id`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `mistake_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mistake_types_name_unique` ON `mistake_types` (`name`);
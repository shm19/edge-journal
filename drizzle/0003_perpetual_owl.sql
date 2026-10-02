CREATE INDEX `attachments_idea_idx` ON `attachments` (`idea_id`);--> statement-breakpoint
CREATE INDEX `idea_mistakes_idea_idx` ON `idea_mistakes` (`idea_id`);--> statement-breakpoint
CREATE INDEX `idea_mistakes_type_idx` ON `idea_mistakes` (`mistake_type_id`);--> statement-breakpoint
CREATE INDEX `idea_mistakes_scenario_idx` ON `idea_mistakes` (`scenario_id`);--> statement-breakpoint
CREATE INDEX `idea_tags_tag_idx` ON `idea_tags` (`tag_id`);--> statement-breakpoint
CREATE INDEX `ideas_setup_idx` ON `ideas` (`setup_id`);--> statement-breakpoint
CREATE INDEX `scenarios_idea_idx` ON `scenarios` (`idea_id`);--> statement-breakpoint
CREATE INDEX `scenarios_type_idx` ON `scenarios` (`scenario_type_id`);
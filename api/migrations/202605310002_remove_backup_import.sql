DROP TABLE IF EXISTS backup_audit_logs;
DROP TABLE IF EXISTS backup_settings;

ALTER TABLE academic_settings
DROP COLUMN IF EXISTS backups_enabled;

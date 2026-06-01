ALTER TABLE courses ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_courses_updated_at ON courses (updated_at);

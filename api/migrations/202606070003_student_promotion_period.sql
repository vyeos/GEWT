ALTER TABLE students
ADD COLUMN IF NOT EXISTS current_course_period integer;

UPDATE students s
SET current_course_period = LEAST(
  GREATEST(((s.current_course_year - 1) * 2) + 1, 1),
  CASE
    WHEN c.duration_type = 'semester' THEN LEAST(c.duration, 8)
    ELSE LEAST(c.duration, 4) * 2
  END
)
FROM courses c
WHERE s.course_id = c.id
  AND s.current_course_period IS NULL;

ALTER TABLE students
ALTER COLUMN current_course_period SET DEFAULT 1;

UPDATE students
SET current_course_period = 1
WHERE current_course_period IS NULL;

ALTER TABLE students
ALTER COLUMN current_course_period SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_current_course_period_check'
  ) THEN
    ALTER TABLE students ADD CONSTRAINT students_current_course_period_check
    CHECK (current_course_period BETWEEN 1 AND 8);
  END IF;
END $$;

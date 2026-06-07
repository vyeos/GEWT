ALTER TABLE students
ADD COLUMN IF NOT EXISTS current_course_year integer;

UPDATE students s
SET current_course_year = LEAST(
  GREATEST(
    (
      CASE
        WHEN EXTRACT(MONTH FROM CURRENT_DATE)::int >= aset.academic_year_start_month
          THEN EXTRACT(YEAR FROM CURRENT_DATE)::int
        ELSE EXTRACT(YEAR FROM CURRENT_DATE)::int - 1
      END
    ) -
    (
      CASE
        WHEN EXTRACT(MONTH FROM s.admission_date)::int >= aset.academic_year_start_month
          THEN EXTRACT(YEAR FROM s.admission_date)::int
        ELSE EXTRACT(YEAR FROM s.admission_date)::int - 1
      END
    ) + 1,
    1
  ),
  LEAST(
    4,
    CASE
      WHEN c.duration_type = 'semester' THEN CEIL(c.duration::numeric / 2)::int
      ELSE c.duration
    END
  )
)
FROM courses c
CROSS JOIN academic_settings aset
WHERE s.course_id = c.id
  AND s.current_course_year IS NULL;

ALTER TABLE students
ALTER COLUMN current_course_year SET DEFAULT 1;

UPDATE students
SET current_course_year = 1
WHERE current_course_year IS NULL;

ALTER TABLE students
ALTER COLUMN current_course_year SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_current_course_year_check'
  ) THEN
    ALTER TABLE students ADD CONSTRAINT students_current_course_year_check
    CHECK (current_course_year BETWEEN 1 AND 4);
  END IF;
END $$;

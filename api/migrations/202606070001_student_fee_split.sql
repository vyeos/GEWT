ALTER TABLE students
  ADD COLUMN IF NOT EXISTS tuition_fee_year_1 numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tuition_fee_year_2 numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tuition_fee_year_3 numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tuition_fee_year_4 numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_fee_year_1 numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_fee_year_2 numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_fee_year_3 numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_fee_year_4 numeric(12,2) NOT NULL DEFAULT 0;

UPDATE students
SET
  tuition_fee_year_1 = CASE WHEN tuition_fee_year_1 = 0 AND other_fee_year_1 = 0 THEN fee_year_1 ELSE tuition_fee_year_1 END,
  tuition_fee_year_2 = CASE WHEN tuition_fee_year_2 = 0 AND other_fee_year_2 = 0 THEN fee_year_2 ELSE tuition_fee_year_2 END,
  tuition_fee_year_3 = CASE WHEN tuition_fee_year_3 = 0 AND other_fee_year_3 = 0 THEN fee_year_3 ELSE tuition_fee_year_3 END,
  tuition_fee_year_4 = CASE WHEN tuition_fee_year_4 = 0 AND other_fee_year_4 = 0 THEN fee_year_4 ELSE tuition_fee_year_4 END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_fee_year_1_split_check'
  ) THEN
    ALTER TABLE students ADD CONSTRAINT students_fee_year_1_split_check
      CHECK (fee_year_1 >= 0 AND tuition_fee_year_1 >= 0 AND other_fee_year_1 >= 0 AND fee_year_1 = tuition_fee_year_1 + other_fee_year_1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_fee_year_2_split_check'
  ) THEN
    ALTER TABLE students ADD CONSTRAINT students_fee_year_2_split_check
      CHECK (fee_year_2 >= 0 AND tuition_fee_year_2 >= 0 AND other_fee_year_2 >= 0 AND fee_year_2 = tuition_fee_year_2 + other_fee_year_2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_fee_year_3_split_check'
  ) THEN
    ALTER TABLE students ADD CONSTRAINT students_fee_year_3_split_check
      CHECK (fee_year_3 >= 0 AND tuition_fee_year_3 >= 0 AND other_fee_year_3 >= 0 AND fee_year_3 = tuition_fee_year_3 + other_fee_year_3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_fee_year_4_split_check'
  ) THEN
    ALTER TABLE students ADD CONSTRAINT students_fee_year_4_split_check
      CHECK (fee_year_4 >= 0 AND tuition_fee_year_4 >= 0 AND other_fee_year_4 >= 0 AND fee_year_4 = tuition_fee_year_4 + other_fee_year_4);
  END IF;
END $$;

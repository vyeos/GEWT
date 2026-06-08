ALTER TABLE students
ADD COLUMN IF NOT EXISTS admission_cancelled boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS admission_cancelled_at timestamptz,
ADD COLUMN IF NOT EXISTS admission_cancelled_by uuid REFERENCES users(id);

UPDATE students
SET
  fee_year_1 = 0,
  fee_year_2 = 0,
  fee_year_3 = 0,
  fee_year_4 = 0,
  tuition_fee_year_1 = 0,
  tuition_fee_year_2 = 0,
  tuition_fee_year_3 = 0,
  tuition_fee_year_4 = 0,
  other_fee_year_1 = 0,
  other_fee_year_2 = 0,
  other_fee_year_3 = 0,
  other_fee_year_4 = 0
WHERE admission_cancelled = true;

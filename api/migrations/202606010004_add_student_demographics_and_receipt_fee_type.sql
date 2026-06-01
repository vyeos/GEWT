ALTER TABLE students
  ADD COLUMN IF NOT EXISTS religion text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS caste text NOT NULL DEFAULT '';

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS fee_type text NOT NULL DEFAULT 'Tuition';

ALTER TABLE receipts
  DROP CONSTRAINT IF EXISTS receipts_fee_type_check,
  ADD CONSTRAINT receipts_fee_type_check CHECK (fee_type IN ('Tuition', 'Other'));

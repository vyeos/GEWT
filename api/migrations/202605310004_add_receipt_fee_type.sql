ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS fee_type text NOT NULL DEFAULT 'Tuition';

ALTER TABLE receipts
  DROP CONSTRAINT IF EXISTS receipts_fee_type_check;

ALTER TABLE receipts
  ADD CONSTRAINT receipts_fee_type_check CHECK (fee_type IN ('Tuition', 'Other'));

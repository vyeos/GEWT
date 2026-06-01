ALTER TABLE receipts ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX idx_students_updated_at ON students (updated_at);
CREATE INDEX idx_receipts_updated_at ON receipts (updated_at);

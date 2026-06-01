CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (name IN ('admin', 'employee'))
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'employee')),
  branch_id uuid REFERENCES branches(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role = 'admin' OR branch_id IS NOT NULL)
);

CREATE TABLE courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  name text NOT NULL,
  duration integer NOT NULL CHECK (duration > 0),
  duration_type text NOT NULL CHECK (duration_type IN ('year', 'semester')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, name)
);

CREATE TABLE academic_settings (
  id boolean PRIMARY KEY DEFAULT true,
  academic_year_start_month integer NOT NULL DEFAULT 9 CHECK (academic_year_start_month BETWEEN 1 AND 12),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id)
);

CREATE TABLE students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_no text NOT NULL UNIQUE,
  admission_date date NOT NULL,
  branch_id uuid NOT NULL REFERENCES branches(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  student_name text NOT NULL,
  category text NOT NULL,
  religion text NOT NULL DEFAULT '',
  caste text NOT NULL DEFAULT '',
  gender text NOT NULL CHECK (gender IN ('Male', 'Female')),
  aadhar text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  student_phone text NOT NULL DEFAULT '',
  parent_phone text NOT NULL DEFAULT '',
  fee_year_1 numeric(12,2) NOT NULL DEFAULT 0,
  fee_year_2 numeric(12,2) NOT NULL DEFAULT 0,
  fee_year_3 numeric(12,2) NOT NULL DEFAULT 0,
  fee_year_4 numeric(12,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no bigint NOT NULL UNIQUE,
  receipt_date date NOT NULL,
  student_id uuid NOT NULL REFERENCES students(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  fee_type text NOT NULL DEFAULT 'Tuition' CHECK (fee_type IN ('Tuition', 'Other')),
  amount_paid numeric(12,2) NOT NULL CHECK (amount_paid > 0),
  payment_mode text NOT NULL CHECK (payment_mode IN ('Cash', 'UPI', 'DD', 'Cheque', 'NEFT', 'RTGS')),
  reference_no text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payment_mode = 'Cash' OR reference_no IS NOT NULL)
);

CREATE INDEX idx_courses_updated_at ON courses (updated_at);
CREATE INDEX idx_students_updated_at ON students (updated_at);
CREATE INDEX idx_receipts_updated_at ON receipts (updated_at);

INSERT INTO branches (code, name) VALUES ('PRT', 'Prantij'), ('HMT', 'HMT'), ('TLD', 'Talod')
ON CONFLICT DO NOTHING;

INSERT INTO roles (name) VALUES ('admin'), ('employee') ON CONFLICT DO NOTHING;

INSERT INTO academic_settings (id, academic_year_start_month) VALUES (true, 9)
ON CONFLICT (id) DO NOTHING;

-- Password is admin123. Rotate immediately in production seed configuration.
INSERT INTO users (user_id, name, password_hash, role)
VALUES ('admin', 'Initial Admin', '$argon2id$v=19$m=19456,t=2,p=1$d1/80bbKsUauEfQW/gLl4g$FMqkF2PX6DU4pRJrSzTsRXu5pU5Hnd80+e0SRRbU/bI', 'admin')
ON CONFLICT (user_id) DO NOTHING;

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
  UNIQUE (branch_id, name)
);

CREATE TABLE academic_settings (
  id boolean PRIMARY KEY DEFAULT true,
  academic_year_start_month integer NOT NULL DEFAULT 9 CHECK (academic_year_start_month BETWEEN 1 AND 12),
  backups_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id)
);

CREATE TABLE numbering_rules (
  key text PRIMARY KEY,
  next_value bigint NOT NULL CHECK (next_value > 0),
  padding integer NOT NULL DEFAULT 0 CHECK (padding >= 0)
);

CREATE TABLE dropdown_masters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_type text NOT NULL,
  value text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (master_type, value)
);

CREATE TABLE students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_no text NOT NULL UNIQUE,
  admission_date date NOT NULL,
  branch_id uuid NOT NULL REFERENCES branches(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  student_name text NOT NULL,
  category text NOT NULL,
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
  amount_paid numeric(12,2) NOT NULL CHECK (amount_paid > 0),
  payment_mode text NOT NULL CHECK (payment_mode IN ('Cash', 'UPI', 'DD', 'Cheque', 'NEFT', 'RTGS')),
  reference_no text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payment_mode = 'Cash' OR reference_no IS NOT NULL)
);

CREATE TABLE backup_settings (
  machine_id text PRIMARY KEY,
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('daily', 'weekly', 'monthly', 'custom')),
  custom_days integer CHECK (custom_days IS NULL OR custom_days > 0),
  location text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE backup_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  file_name text NOT NULL,
  file_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO branches (code, name) VALUES ('PRT', 'Prantij'), ('HMT', 'HMT'), ('TLD', 'Talod')
ON CONFLICT DO NOTHING;

INSERT INTO roles (name) VALUES ('admin'), ('employee') ON CONFLICT DO NOTHING;

INSERT INTO academic_settings (id, academic_year_start_month) VALUES (true, 9)
ON CONFLICT (id) DO NOTHING;

INSERT INTO numbering_rules (key, next_value, padding) VALUES ('student_form', 1, 4), ('receipt', 1, 0)
ON CONFLICT DO NOTHING;

INSERT INTO dropdown_masters (master_type, value) VALUES
  ('category', 'General'), ('category', 'OBC'), ('category', 'SC'), ('category', 'ST'),
  ('gender', 'Male'), ('gender', 'Female')
ON CONFLICT DO NOTHING;

-- Password is admin123. Rotate immediately in production seed configuration.
INSERT INTO users (user_id, name, password_hash, role)
VALUES ('admin', 'Initial Admin', '$argon2id$v=19$m=19456,t=2,p=1$uIf5O8g6h2qTDK+5yJVbEQ$uWOOMcECKkSGzpR3+y1hBa8AUKy40bYa15k5B8hbkrg', 'admin')
ON CONFLICT (user_id) DO NOTHING;

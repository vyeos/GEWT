export type Role = "admin" | "employee";

export type Screen =
  | "admission"
  | "receipt"
  | "outstanding"
  | "utility";

export type PaymentMode = "Cash" | "UPI" | "DD" | "Cheque" | "NEFT" | "RTGS";

export type Branch = { id: string; code: string; name: string };

export type Course = {
  id: string;
  branch_id: string;
  name: string;
  duration: number;
  duration_type: "year" | "semester";
};

export type User = {
  id: string;
  user_id: string;
  name: string;
  role: Role;
  branch_id: string | null;
};

export type Me = User & {
  branch_name: string | null;
  academic_year_start_month: number;
};

export type Student = {
  id: string;
  form_no: string;
  admission_date: string;
  branch_id: string;
  branch_name: string;
  course_id: string;
  course_name: string;
  course_duration: number;
  course_duration_type: "year" | "semester";
  student_name: string;
  category: string;
  religion: string;
  caste: string;
  gender: string;
  aadhar: string;
  address: string;
  student_phone: string;
  parent_phone: string;
  fee_year_1: number;
  fee_year_2: number;
  fee_year_3: number;
  fee_year_4: number;
};

export type OutstandingRow = Student & {
  total_due: number;
  total_paid: number;
  pending: number;
  current_period: string;
  last_receipt_no: string | null;
};

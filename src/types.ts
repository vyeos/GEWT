type Role = "admin" | "employee";

export type Screen =
  | "admission"
  | "receipt"
  | "promote"
  | "outstanding"
  | "students"
  | "backup"
  | "utility";

export type PaymentMode = "Cash" | "UPI" | "DD" | "Cheque" | "NEFT" | "RTGS";

export type Branch = { id: string; code: string; name: string };

export type Course = {
  id: string;
  branch_id: string;
  name: string;
  duration: number;
  duration_type: "year" | "semester";
  letterhead: string | null;
  active: boolean;
};

export type User = {
  id: string;
  user_id: string;
  name: string;
  role: Role;
  branch_id: string | null;
  active: boolean;
  can_admission: boolean;
  can_receipt: boolean;
  can_outstanding: boolean;
  can_students: boolean;
  can_promote: boolean;
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
  current_course_period: number;
  student_name: string;
  surname: string;
  father_name: string;
  category: string;
  religion: string;
  caste: string;
  gender: string;
  aadhar: string;
  address: string;
  district: string;
  taluka: string;
  pincode: string;
  student_phone: string;
  parent_phone: string;
  photo: string;
  fee_year_1: number;
  fee_year_2: number;
  fee_year_3: number;
  fee_year_4: number;
  tuition_fee_year_1: number;
  tuition_fee_year_2: number;
  tuition_fee_year_3: number;
  tuition_fee_year_4: number;
  other_fee_year_1: number;
  other_fee_year_2: number;
  other_fee_year_3: number;
  other_fee_year_4: number;
  admission_cancelled: boolean;
  admission_cancelled_at: string | null;
};

export type OutstandingFeeBreakdown = {
  due: number;
  paid: number;
  pending: number;
};

export type OutstandingYearBreakdown = {
  year: number;
  tuition: OutstandingFeeBreakdown;
  other: OutstandingFeeBreakdown;
  total_due: number;
  total_paid: number;
  pending: number;
};

export type OutstandingRow = Student & {
  total_due: number;
  total_paid: number;
  pending: number;
  current_period: string;
  last_receipt_no: string | null;
  year_breakdown: OutstandingYearBreakdown[];
};

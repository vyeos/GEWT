import type { Me, Student, User } from "@/types";

export function makeUser(overrides: Partial<User> = {}): User {
  const base: User = {
    id: "user-1",
    user_id: "admin",
    name: "Admin User",
    role: "admin",
    branch_id: null,
    active: true,
    can_admission: true,
    can_receipt: true,
    can_outstanding: true,
    can_students: true,
    can_promote: true,
  };
  return { ...base, ...overrides };
}

export function makeMe(overrides: Partial<Me> = {}): Me {
  const base: Me = {
    id: "user-1",
    user_id: "admin",
    name: "Admin User",
    role: "admin",
    branch_id: null,
    active: true,
    branch_name: null,
    academic_year_start_month: 9,
    can_admission: true,
    can_receipt: true,
    can_outstanding: true,
    can_students: true,
    can_promote: true,
  };
  return { ...base, ...overrides };
}

export function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "student-1",
    form_no: "PRJ-1-2026",
    admission_date: "2026-09-01",
    branch_id: "branch-1",
    branch_name: "Prantij",
    course_id: "course-1",
    course_name: "B.Sc.",
    course_duration: 3,
    course_duration_type: "year",
    current_course_period: 1,
    student_name: "Test Student",
    surname: "Test",
    father_name: "Father",
    category: "General",
    religion: "",
    caste: "",
    gender: "Male",
    aadhar: "",
    address: "",
    district: "",
    taluka: "",
    pincode: "",
    student_phone: "",
    parent_phone: "",
    photo: "",
    fee_year_1: 1000,
    fee_year_2: 1000,
    fee_year_3: 1000,
    fee_year_4: 0,
    tuition_fee_year_1: 1000,
    tuition_fee_year_2: 1000,
    tuition_fee_year_3: 1000,
    tuition_fee_year_4: 0,
    other_fee_year_1: 0,
    other_fee_year_2: 0,
    other_fee_year_3: 0,
    other_fee_year_4: 0,
    admission_cancelled: false,
    admission_cancelled_at: null,
    ...overrides,
  };
}

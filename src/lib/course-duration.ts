import type { Course, Student } from "@/types";

type CourseDurationSource =
  | Pick<Course, "duration" | "duration_type">
  | Pick<Student, "course_duration" | "course_duration_type">;

export type CourseBillingPeriod = {
  year: number;
  semester: number | null;
  label: string;
};

function getDuration(source: CourseDurationSource) {
  if ("course_duration" in source) {
    return {
      value: source.course_duration,
      type: source.course_duration_type,
    };
  }

  return {
    value: source.duration,
    type: source.duration_type,
  };
}

export function getCourseDuration(source: CourseDurationSource) {
  const duration = getDuration(source);
  const totalSemesters =
    duration.type === "semester" ? duration.value : duration.value * 2;
  const totalYears =
    duration.type === "semester"
      ? Math.ceil(duration.value / 2)
      : duration.value;

  return {
    rawValue: duration.value,
    type: duration.type,
    totalSemesters,
    totalYears,
    label: `${duration.value} ${duration.type}${
      duration.value === 1 ? "" : "s"
    }`,
  };
}

export function getCurrentCoursePeriod(student: Student) {
  const { totalSemesters } = getCourseDuration(student);
  const period =
    student.current_course_period ??
    (student.current_course_year
      ? (student.current_course_year - 1) * 2 + 1
      : undefined);

  return Math.min(Math.max(period ?? 1, 1), totalSemesters);
}

export function getCourseBillingPeriods(
  source: CourseDurationSource,
): CourseBillingPeriod[] {
  const duration = getCourseDuration(source);
  const periodName = duration.type === "semester" ? "Semester" : "Term";

  return Array.from({ length: duration.totalSemesters }, (_, index) => {
    const semester = index + 1;
    return {
      year: Math.ceil(semester / 2),
      semester,
      label: `${periodName} ${semester}`,
    };
  });
}

function academicYearFor(date: Date, academicStartMonth: number) {
  return date.getMonth() + 1 >= academicStartMonth
    ? date.getFullYear()
    : date.getFullYear() - 1;
}

function ordinal(value: number) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export function getCurrentCourseYear(
  student: Student,
  academicStartMonth: number,
  now = new Date(),
) {
  if (student.current_course_period) {
    const { totalYears } = getCourseDuration(student);
    return Math.min(
      Math.max(Math.ceil(getCurrentCoursePeriod(student) / 2), 1),
      totalYears,
    );
  }

  if (student.current_course_year) {
    const { totalYears } = getCourseDuration(student);
    return Math.min(Math.max(student.current_course_year, 1), totalYears);
  }

  const admission = new Date(student.admission_date);
  const currentYear =
    academicYearFor(now, academicStartMonth) -
    academicYearFor(admission, academicStartMonth) +
    1;
  const { totalYears } = getCourseDuration(student);

  return Math.min(Math.max(currentYear, 1), totalYears);
}

export function formatCourseYear(year: number) {
  return `${ordinal(year)} Year`;
}

export function formatCoursePeriod(student: Student, period: number) {
  return `${student.course_duration_type === "semester" ? "Semester" : "Term"} ${period}`;
}

import type { Course, Student } from "@/types";

type CourseDurationSource =
  | Pick<Course, "duration" | "duration_type">
  | Pick<Student, "course_duration" | "course_duration_type">;

export type CourseBillingPeriod = {
  year: number;
  // Every billed period is half a year, so even year-type courses bill in two
  // "Term" periods per year; this is always a positive period index.
  semester: number;
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
  // The backend only models 4 year-fee columns / 8 periods, so clamp here to
  // keep the UI from showing years the backend will never bill (see
  // total_course_years/total_course_periods in src-tauri/src/db.rs).
  const totalSemesters = Math.min(
    duration.type === "semester" ? duration.value : duration.value * 2,
    8,
  );
  const totalYears = Math.min(
    duration.type === "semester"
      ? Math.ceil(duration.value / 2)
      : duration.value,
    4,
  );

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
  return Math.min(Math.max(student.current_course_period, 1), totalSemesters);
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

// The course year is always derived from the billing period the office has
// promoted the student to (the backend guarantees current_course_period).
export function getCurrentCourseYear(student: Student) {
  const { totalYears } = getCourseDuration(student);
  return Math.min(
    Math.max(Math.ceil(getCurrentCoursePeriod(student) / 2), 1),
    totalYears,
  );
}

export function formatCourseYear(year: number) {
  return `${ordinal(year)} Year`;
}

export function formatPeriodLabel(durationType: string, period: number) {
  return `${durationType === "semester" ? "Semester" : "Term"} ${period}`;
}

export function formatCoursePeriod(student: Student, period: number) {
  return formatPeriodLabel(student.course_duration_type, period);
}

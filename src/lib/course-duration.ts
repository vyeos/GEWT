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

export function getCourseBillingPeriods(
  source: CourseDurationSource,
): CourseBillingPeriod[] {
  const duration = getCourseDuration(source);

  return Array.from({ length: duration.totalSemesters }, (_, index) => {
    const semester = index + 1;
    return {
      year: Math.ceil(semester / 2),
      semester,
      label: `Sem ${semester}`,
    };
  });
}

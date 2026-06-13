import { describe, expect, it } from "vitest";
import {
  formatCoursePeriod,
  formatCourseYear,
  getCourseBillingPeriods,
  getCourseDuration,
  getCurrentCoursePeriod,
  getCurrentCourseYear,
} from "@/lib/course-duration";
import { makeStudent } from "@/test/factories";

describe("course duration helpers", () => {
  it("converts yearly courses into two billing periods per year", () => {
    expect(getCourseDuration({ duration: 3, duration_type: "year" })).toEqual({
      rawValue: 3,
      type: "year",
      totalSemesters: 6,
      totalYears: 3,
      label: "3 years",
    });
  });

  it("converts semester courses into the expected total years", () => {
    expect(getCourseDuration({ duration: 8, duration_type: "semester" })).toMatchObject({
      totalSemesters: 8,
      totalYears: 4,
      label: "8 semesters",
    });
  });

  it("labels billing periods as terms for yearly courses and semesters for semester courses", () => {
    expect(getCourseBillingPeriods({ duration: 1, duration_type: "year" })).toEqual([
      { year: 1, semester: 1, label: "Term 1" },
      { year: 1, semester: 2, label: "Term 2" },
    ]);
    expect(getCourseBillingPeriods({ duration: 2, duration_type: "semester" })).toEqual([
      { year: 1, semester: 1, label: "Semester 1" },
      { year: 1, semester: 2, label: "Semester 2" },
    ]);
  });

  it("caps totals at the 4-year / 8-semester ceiling the backend bills", () => {
    // The backend rejects courses longer than this, but the helper must still
    // never report more years/periods than the fee model supports, so the UI
    // can't diverge from what outstanding() actually bills.
    expect(getCourseDuration({ duration: 5, duration_type: "year" })).toMatchObject({
      totalYears: 4,
      totalSemesters: 8,
      label: "5 years",
    });
    expect(getCourseDuration({ duration: 12, duration_type: "semester" })).toMatchObject({
      totalYears: 4,
      totalSemesters: 8,
      label: "12 semesters",
    });
  });

  it("clamps current periods and derives the current course year", () => {
    expect(getCurrentCoursePeriod(makeStudent({ current_course_period: 0 }))).toBe(1);
    expect(getCurrentCoursePeriod(makeStudent({ current_course_period: 99 }))).toBe(6);
    expect(getCurrentCourseYear(makeStudent({ current_course_period: 3 }))).toBe(2);
  });

  it("formats ordinals and period labels", () => {
    expect(formatCourseYear(1)).toBe("1st Year");
    expect(formatCourseYear(2)).toBe("2nd Year");
    expect(formatCourseYear(3)).toBe("3rd Year");
    expect(formatCourseYear(11)).toBe("11th Year");
    expect(formatCoursePeriod(makeStudent({ course_duration_type: "semester" }), 4)).toBe(
      "Semester 4",
    );
    expect(formatCoursePeriod(makeStudent({ course_duration_type: "year" }), 4)).toBe("Term 4");
  });
});

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import {
  formatCourseYear,
  formatCoursePeriod,
  getCourseDuration,
  getCurrentCoursePeriod,
  getCurrentCourseYear,
} from "@/lib/course-duration";
import { cn } from "@/lib/utils";
import type { Branch, Course, Me, Student } from "@/types";

type PromoteResponse = {
  promoted_count: number;
  skipped_count: number;
  students: Student[];
};

function admissionYear(student: Student) {
  return student.admission_date.slice(0, 4);
}

export function Promote({
  token,
  me,
  branches,
  courses,
  refreshKey,
  onPromoted,
}: {
  token: string;
  me: Me;
  branches: Branch[];
  courses: Course[];
  refreshKey: number;
  onPromoted: () => void;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [courseId, setCourseId] = useState("");
  const [admissionYearValue, setAdmissionYearValue] = useState("");
  const [courseOpen, setCourseOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const allowedBranches =
    me.role === "admin"
      ? branches
      : branches.filter((branch) => branch.id === me.branch_id);
  const branchCourseGroups = allowedBranches
    .map((branch) => ({
      branch,
      branchCourses: courses.filter((course) => course.branch_id === branch.id),
    }))
    .filter((group) => group.branchCourses.length > 0);
  const selectedCourse = courses.find((course) => course.id === courseId);
  const selectedBranch = branches.find(
    (branch) => branch.id === selectedCourse?.branch_id,
  );
  const admissionYears = useMemo(() => {
    const years = new Set<string>();
    for (const student of students) {
      if (courseId && student.course_id !== courseId) continue;
      years.add(admissionYear(student));
    }
    return [...years].sort((a, b) => Number(b) - Number(a));
  }, [courseId, students]);
  const canShowTable = Boolean(courseId && admissionYearValue);
  const visibleStudents = useMemo(
    () =>
      canShowTable
        ? students.filter(
            (student) =>
              student.course_id === courseId &&
              admissionYear(student) === admissionYearValue,
          )
        : [],
    [admissionYearValue, canShowTable, courseId, students],
  );
  const selectableIds = visibleStudents
    .filter((student) => canPromote(student))
    .map((student) => student.id);
  const selectedStudents = visibleStudents.filter((student) =>
    selectedIds.has(student.id),
  );
  const allSelectableSelected =
    selectableIds.length > 0 &&
    selectableIds.every((studentId) => selectedIds.has(studentId));
  const selectAllState =
    allSelectableSelected || selectedIds.size === 0
      ? allSelectableSelected
      : "indeterminate";

  function canPromote(student: Student) {
    const period = getCurrentCoursePeriod(student);
    return period < getCourseDuration(student).totalSemesters;
  }

  useEffect(() => {
    async function loadStudents() {
      try {
        setStudents(await api<Student[]>("/students", token));
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Unable to load students",
        );
      }
    }

    void loadStudents();
  }, [token, refreshKey]);

  useEffect(() => {
    if (!admissionYearValue || admissionYears.includes(admissionYearValue)) {
      return;
    }
    setAdmissionYearValue("");
    setSelectedIds(new Set());
  }, [admissionYearValue, admissionYears]);

  function toggleStudent(studentId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(studentId);
      } else {
        next.delete(studentId);
      }
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const studentId of selectableIds) {
        if (checked) {
          next.add(studentId);
        } else {
          next.delete(studentId);
        }
      }
      return next;
    });
  }

  async function confirmPromotion() {
    if (!selectedCourse || !admissionYearValue || selectedIds.size === 0) {
      return;
    }

    setIsPromoting(true);
    try {
      // Send only selections that are still visible under the current course
      // and year — stale ids from an earlier filter would fail the whole batch.
      const studentIds = selectedStudents.map((student) => student.id);
      const result = await api<PromoteResponse>("/students/promote", token, {
        method: "POST",
        body: JSON.stringify({
          course_id: selectedCourse.id,
          admission_year: Number(admissionYearValue),
          student_ids: studentIds,
        }),
      });
      const updatedById = new Map(
        result.students.map((student) => [student.id, student]),
      );
      setStudents((current) =>
        current.map((student) => updatedById.get(student.id) ?? student),
      );
      setCourseId("");
      setAdmissionYearValue("");
      setSelectedIds(new Set());
      setConfirmOpen(false);
      if (result.promoted_count > 0) {
        toast.success(`Promoted ${result.promoted_count} student(s)`);
      }
      if (result.skipped_count > 0) {
        toast.warning(
          `${result.skipped_count} student(s) already at final semester/term`,
        );
      }
      onPromoted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Promotion failed");
    } finally {
      setIsPromoting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_12rem_auto]">
          <div className="flex flex-col gap-2">
            <Label>Course</Label>
            <Popover open={courseOpen} onOpenChange={setCourseOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={courseOpen}
                  className="w-full justify-between font-normal"
                >
                  {selectedCourse ? (
                    <span className="truncate">
                      {selectedCourse.name}
                      <span className="ml-1.5 text-muted-foreground">
                        ({selectedBranch?.name})
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Select course</span>
                  )}
                  <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-auto min-w-[var(--radix-popover-trigger-width)] p-0"
                align="start"
              >
                {branchCourseGroups.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No results found
                  </div>
                ) : (
                  <div className="flex divide-x">
                    {branchCourseGroups.map(({ branch, branchCourses }) => (
                      <div key={branch.id} className="min-w-40 flex-1 p-1">
                        <div className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
                          {branch.name}
                        </div>
                        {branchCourses.map((course) => (
                          <button
                            key={course.id}
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                              courseId === course.id && "bg-accent",
                            )}
                            onClick={() => {
                              setCourseId(course.id);
                              setAdmissionYearValue("");
                              setSelectedIds(new Set());
                              setCourseOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "size-4 shrink-0",
                                courseId === course.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <span className="truncate">{course.name}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Admission Year</Label>
            <Select
              value={admissionYearValue}
              onValueChange={(value) => {
                setAdmissionYearValue(value);
                setSelectedIds(new Set());
              }}
              disabled={!courseId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {admissionYears.length === 0 ? (
                    <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                      No results found
                    </div>
                  ) : (
                    admissionYears.map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end justify-end">
            <Button
              type="button"
              disabled={selectedIds.size === 0 || isPromoting}
              onClick={() => setConfirmOpen(true)}
            >
              <GraduationCap className="size-4" />
              Promote
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="p-0">
        <CardContent className="p-0">
          {!canShowTable ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Select course and admission year to view students
            </p>
          ) : visibleStudents.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No students found
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectAllState}
                      disabled={selectableIds.length === 0}
                      aria-label="Select all students"
                      onCheckedChange={(checked) =>
                        toggleAll(checked === true)
                      }
                    />
                  </TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Current Period</TableHead>
                  <TableHead>Current Year</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleStudents.map((student) => {
                  const currentYear = getCurrentCourseYear(
                    student,
                    me.academic_year_start_month,
                  );
                  const currentPeriod = getCurrentCoursePeriod(student);
                  const totalPeriods = getCourseDuration(student).totalSemesters;
                  const eligible = currentPeriod < totalPeriods;
                  return (
                    <TableRow
                      key={student.id}
                      data-state={
                        selectedIds.has(student.id) ? "selected" : undefined
                      }
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(student.id)}
                          disabled={!eligible}
                          aria-label={`Select ${student.student_name}`}
                          onCheckedChange={(checked) =>
                            toggleStudent(student.id, checked === true)
                          }
                        />
                      </TableCell>
                      <TableCell>{student.form_no}</TableCell>
                      <TableCell className="font-medium">
                        {student.student_name}
                      </TableCell>
                      <TableCell>{student.branch_name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{student.course_name}</Badge>
                      </TableCell>
                      <TableCell>
                        {formatCoursePeriod(student, currentPeriod)}
                      </TableCell>
                      <TableCell>{formatCourseYear(currentYear)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Promotion</AlertDialogTitle>
            <AlertDialogDescription>
              Promote {selectedStudents.length} selected student(s) from{" "}
              {selectedCourse?.name} admission year {admissionYearValue} to the
              next semester/term?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPromoting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPromoting}
              onClick={(event) => {
                event.preventDefault();
                void confirmPromotion();
              }}
            >
              {isPromoting ? "Promoting..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

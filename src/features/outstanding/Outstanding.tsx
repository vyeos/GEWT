import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { formatCourseYear, getCourseDuration } from "@/lib/course-duration";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  Branch,
  Course,
  Me,
  OutstandingFeeBreakdown,
  OutstandingRow,
  OutstandingYearBreakdown,
} from "@/types";

function admissionYear(row: OutstandingRow) {
  return row.admission_date.slice(0, 4);
}

function emptyFee(): OutstandingFeeBreakdown {
  return { due: 0, paid: 0, pending: 0 };
}

function emptyYearBreakdown(year: number): OutstandingYearBreakdown {
  return {
    year,
    tuition: emptyFee(),
    other: emptyFee(),
    total_due: 0,
    total_paid: 0,
    pending: 0,
  };
}

function yearBreakdown(row: OutstandingRow, year: number) {
  return (
    row.year_breakdown.find((breakdown) => breakdown.year === year) ??
    emptyYearBreakdown(year)
  );
}

function currentCourseYear(row: OutstandingRow) {
  if (row.current_course_period) {
    return Math.min(
      Math.max(Math.ceil(row.current_course_period / 2), 1),
      getCourseDuration(row).totalYears,
    );
  }

  return Math.min(
    Math.max(row.current_course_year ?? 1, 1),
    getCourseDuration(row).totalYears,
  );
}

function totalBreakdown(row: OutstandingRow): OutstandingYearBreakdown {
  const totals = row.year_breakdown.reduce(
    (sum, breakdown) => ({
      tuition: {
        due: sum.tuition.due + breakdown.tuition.due,
        paid: sum.tuition.paid + breakdown.tuition.paid,
        pending: sum.tuition.pending + breakdown.tuition.pending,
      },
      other: {
        due: sum.other.due + breakdown.other.due,
        paid: sum.other.paid + breakdown.other.paid,
        pending: sum.other.pending + breakdown.other.pending,
      },
    }),
    { tuition: emptyFee(), other: emptyFee() },
  );

  return {
    year: 0,
    tuition: totals.tuition,
    other: totals.other,
    total_due: row.total_due,
    total_paid: row.total_paid,
    pending: row.pending,
  };
}

function FeeTooltip({
  label,
  breakdown,
  children,
}: {
  label: string;
  breakdown: OutstandingYearBreakdown;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex w-full justify-end rounded-sm underline decoration-dotted underline-offset-4 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="min-w-64 bg-popover p-3 text-popover-foreground ring-1 ring-border">
        <div className="flex flex-col gap-2">
          <p className="font-medium">{label}</p>
          <div className="grid grid-cols-[4.5rem_1fr_1fr] gap-x-3 gap-y-1 text-[11px]">
            <span className="text-muted-foreground">Type</span>
            <span className="text-right text-muted-foreground">Due</span>
            <span className="text-right text-muted-foreground">Paid</span>
            <span>Tuition</span>
            <span className="text-right">{money(breakdown.tuition.due)}</span>
            <span className="text-right">{money(breakdown.tuition.paid)}</span>
            <span>Other</span>
            <span className="text-right">{money(breakdown.other.due)}</span>
            <span className="text-right">{money(breakdown.other.paid)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function Outstanding({
  token,
  me,
  refreshKey,
  branches,
  courses,
}: {
  token: string;
  me: Me;
  refreshKey: number;
  branches: Branch[];
  courses: Course[];
}) {
  const [rows, setRows] = useState<OutstandingRow[]>([]);
  const [courseId, setCourseId] = useState("");
  const [admissionYearValue, setAdmissionYearValue] = useState("");
  const [courseOpen, setCourseOpen] = useState(false);
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
    for (const row of rows) {
      if (courseId && row.course_id !== courseId) continue;
      years.add(admissionYear(row));
    }
    return [...years].sort((a, b) => Number(b) - Number(a));
  }, [courseId, rows]);
  const courseYears = useMemo(
    () =>
      selectedCourse
        ? Array.from(
            { length: getCourseDuration(selectedCourse).totalYears },
            (_, index) => index + 1,
          )
        : [],
    [selectedCourse],
  );
  const canShowTable = Boolean(courseId && admissionYearValue);
  const visibleRows = useMemo(
    () =>
      canShowTable
        ? rows.filter(
            (row) =>
              row.course_id === courseId &&
              admissionYear(row) === admissionYearValue,
          )
        : [],
    [admissionYearValue, canShowTable, courseId, rows],
  );

  useEffect(() => {
    async function loadOutstanding() {
      try {
        setRows(await api<OutstandingRow[]>("/reports/outstanding", token));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to load outstanding report",
        );
      }
    }

    void loadOutstanding();
  }, [token, refreshKey]);

  useEffect(() => {
    if (!admissionYearValue || admissionYears.includes(admissionYearValue)) {
      return;
    }
    setAdmissionYearValue("");
  }, [admissionYearValue, admissionYears]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_12rem] lg:w-[44rem]">
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
                    <span className="text-muted-foreground">
                      Select course
                    </span>
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
              onValueChange={setAdmissionYearValue}
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
        </CardContent>
      </Card>

      <Card className="p-0">
        <CardContent className="p-0">
          {!canShowTable ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Select course and admission year to view outstanding fees
            </p>
          ) : visibleRows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No outstanding fees found
            </p>
          ) : (
            <TooltipProvider>
              <Table className="min-w-[820px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Form No</TableHead>
                    <TableHead className="w-64">Name</TableHead>
                    <TableHead className="w-28">Period</TableHead>
                    {courseYears.map((year) => (
                      <TableHead key={year} className="w-36 text-right">
                        {formatCourseYear(year)}
                      </TableHead>
                    ))}
                    <TableHead className="w-36 text-right">Pending</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => {
                    const studentCurrentYear = currentCourseYear(row);
                    return (
                      <TableRow key={row.id}>
                        <TableCell>{row.form_no}</TableCell>
                        <TableCell className="truncate font-medium">
                          {row.student_name}
                        </TableCell>
                        <TableCell>{row.current_period}</TableCell>
                        {courseYears.map((year) => {
                          const breakdown = yearBreakdown(row, year);
                          if (year > studentCurrentYear) {
                            return (
                              <TableCell
                                key={year}
                                className="text-right text-muted-foreground"
                              >
                                —
                              </TableCell>
                            );
                          }
                          return (
                            <TableCell key={year} className="text-right">
                              <FeeTooltip
                                label={`${formatCourseYear(year)} pending fee`}
                                breakdown={breakdown}
                              >
                                <span
                                  className={cn(
                                    "font-medium",
                                    breakdown.pending > 0
                                      ? "text-destructive"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {money(breakdown.pending)}
                                </span>
                              </FeeTooltip>
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right">
                          <FeeTooltip
                            label="Total pending fee"
                            breakdown={totalBreakdown(row)}
                          >
                            <span className="font-semibold text-destructive">
                              {money(row.pending)}
                            </span>
                          </FeeTooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Printer,
  ReceiptText,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { paymentModes } from "@/data/seeds";
import { api } from "@/lib/api";
import {
  cacheReceipt,
  getCachedReceipts,
  getCachedStudents,
  syncReceipts,
  syncScope,
  syncStudents,
} from "@/lib/cache";
import {
  formatCoursePeriod,
  formatCourseYear,
  getCourseBillingPeriods,
  getCurrentCoursePeriod,
  getCurrentCourseYear,
} from "@/lib/course-duration";
import { money, today } from "@/lib/format";
import { letterheadSrc } from "@/lib/letterhead";
import { cn } from "@/lib/utils";
import type { Branch, Course, Me, PaymentMode, Student } from "@/types";
import { ReceiptPrint, type PrintableReceipt } from "./ReceiptPrint";

type ReceiptRow = {
  receipt_no: number;
};

type StudentReceipt = {
  id?: string;
  optimistic_id?: string;
  receipt_no: string | number;
  receipt_date: string;
  fee_type: string;
  payment_mode: PaymentMode;
  amount_paid: number;
  reference_no: string | null;
};

const feeTypes = ["Tuition", "Other"] as const;
type FeeType = (typeof feeTypes)[number];

export function Receipt({
  token,
  me,
  branches,
  courses,
  refreshKey,
}: {
  token: string;
  me: Me;
  branches: Branch[];
  courses: Course[];
  refreshKey: number;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [courseId, setCourseId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [generatedReceiptNo, setGeneratedReceiptNo] = useState("");
  const [receiptDate, setReceiptDate] = useState(today());
  const [feeType, setFeeType] = useState<FeeType>("Tuition");
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [amount, setAmount] = useState(0);
  const [reference, setReference] = useState("");
  const [courseOpen, setCourseOpen] = useState(false);
  const [studentOpen, setStudentOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [studentReceipts, setStudentReceipts] = useState<StudentReceipt[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [printReceipt, setPrintReceipt] = useState<PrintableReceipt | null>(
    null,
  );
  const printAfterRenderRef = useRef(false);
  const requiresRef = mode !== "Cash";
  const branchScopeId =
    me.role === "admin" ? undefined : (me.branch_id ?? undefined);
  const cacheScope = syncScope(me);
  const allowedBranches =
    me.role === "admin"
      ? branches
      : branches.filter((branch) => branch.id === me.branch_id);
  const selectedCourse = courses.find((course) => course.id === courseId);
  const branchCourseGroups = allowedBranches
    .map((branch) => ({
      branch,
      branchCourses: courses.filter((course) => course.branch_id === branch.id),
    }))
    .filter((group) => group.branchCourses.length > 0);
  const selectedStudent = students.find((student) => student.id === studentId);
  const selectedStudentCurrentYear = selectedStudent
    ? getCurrentCourseYear(selectedStudent, me.academic_year_start_month)
    : null;
  const selectedStudentCurrentPeriod = selectedStudent
    ? getCurrentCoursePeriod(selectedStudent)
    : null;
  const selectedBranch = branches.find(
    (branch) => branch.id === selectedStudent?.branch_id,
  );
  // The receipt prints on the student's actual course letterhead; before a
  // student is picked, fall back to the course filter selection for the preview.
  const selectedStudentCourse = courses.find(
    (course) => course.id === selectedStudent?.course_id,
  );
  const previewCourse = selectedStudentCourse ?? selectedCourse;
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const student of students) {
      if (courseId && student.course_id !== courseId) continue;
      years.add(getCurrentCourseYear(student, me.academic_year_start_month));
    }
    return [...years].sort((a, b) => a - b);
  }, [students, courseId, me.academic_year_start_month]);
  const visibleStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    return students.filter((student) => {
      if (courseId && student.course_id !== courseId) return false;
      if (
        yearFilter !== "all" &&
        getCurrentCourseYear(student, me.academic_year_start_month) !==
          Number(yearFilter)
      )
        return false;
      if (!query) return true;
      return `${student.form_no} ${student.student_name} ${student.course_name}`
        .toLowerCase()
        .includes(query);
    });
  }, [
    courseId,
    studentSearch,
    students,
    yearFilter,
    me.academic_year_start_month,
  ]);

  async function loadNextReceiptNo() {
    try {
      const next = await api<{ receipt_no: string }>(
        "/receipts/next-receipt-no",
        token,
      );
      setGeneratedReceiptNo(next.receipt_no);
      setReceiptNo(next.receipt_no);
    } catch {
      try {
        const receipts = await api<ReceiptRow[]>("/receipts", token);
        const nextReceiptNo = String(
          Math.max(0, ...receipts.map((receipt) => receipt.receipt_no)) + 1,
        );
        setGeneratedReceiptNo(nextReceiptNo);
        setReceiptNo(nextReceiptNo);
      } catch {
        setGeneratedReceiptNo("");
        setReceiptNo("");
      }
    }
  }

  useEffect(() => {
    async function loadStudents() {
      let showedCachedData = false;
      try {
        const cachedStudents = await getCachedStudents(branchScopeId);
        if (cachedStudents.length > 0) {
          setStudents(cachedStudents);
          showedCachedData = true;
        }
      } catch {
        // The cache is only available in Tauri. Browser dev falls back below.
      }

      try {
        await syncStudents(token, cacheScope);
        setStudents(await getCachedStudents(branchScopeId));
      } catch (error) {
        try {
          setStudents(await api<Student[]>("/students", token));
        } catch {
          if (!showedCachedData) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Unable to load students",
            );
          }
        }
      }
    }

    void loadStudents();
  }, [branchScopeId, cacheScope, token, refreshKey]);

  useEffect(() => {
    void loadNextReceiptNo();
  }, [token]);

  useEffect(() => {
    if (!studentId || !courseId) return;
    const student = students.find((item) => item.id === studentId);
    if (student && student.course_id !== courseId) setStudentId("");
  }, [courseId, studentId, students]);

  useEffect(() => {
    if (yearFilter !== "all" && !availableYears.includes(Number(yearFilter))) {
      setYearFilter("all");
    }
  }, [availableYears, yearFilter]);

  useEffect(() => {
    if (!studentId) {
      setStudentReceipts([]);
      return;
    }
    async function loadStudentReceipts() {
      let showedCachedData = false;
      try {
        const cachedReceipts = await getCachedReceipts(
          studentId,
          branchScopeId,
        );
        setStudentReceipts(cachedReceipts as StudentReceipt[]);
        showedCachedData = cachedReceipts.length > 0;
      } catch {
        // The cache is only available in Tauri. Browser dev falls back below.
      }

      try {
        await syncReceipts(token, cacheScope);
        setStudentReceipts(
          (await getCachedReceipts(
            studentId,
            branchScopeId,
          )) as StudentReceipt[],
        );
      } catch {
        try {
          const data = await api<StudentReceipt[]>(
            `/receipts?student_id=${encodeURIComponent(studentId)}`,
            token,
          );
          setStudentReceipts(data);
        } catch {
          if (!showedCachedData) setStudentReceipts([]);
        }
      }
    }
    void loadStudentReceipts();
  }, [branchScopeId, cacheScope, studentId, token, refreshKey]);

  const feeStatusRows = useMemo(() => {
    if (!selectedStudent) return [];
    const feeGroups = [
      {
        feeType: "Tuition",
        fees: [
          selectedStudent.tuition_fee_year_1,
          selectedStudent.tuition_fee_year_2,
          selectedStudent.tuition_fee_year_3,
          selectedStudent.tuition_fee_year_4,
        ],
      },
      {
        feeType: "Other",
        fees: [
          selectedStudent.other_fee_year_1,
          selectedStudent.other_fee_year_2,
          selectedStudent.other_fee_year_3,
          selectedStudent.other_fee_year_4,
        ],
      },
    ];
    const currentPeriod = getCurrentCoursePeriod(selectedStudent);

    const paidByType = new Map<string, number>();
    for (const r of studentReceipts) {
      const key = r.fee_type || "Tuition";
      paidByType.set(key, (paidByType.get(key) ?? 0) + r.amount_paid);
    }
    const rows: {
      feeType: string;
      period: string;
      periodOrder: number;
      feeTypeOrder: number;
      total: number;
      pending: number;
    }[] = [];
    const periods = getCourseBillingPeriods(selectedStudent);
    for (const [feeTypeOrder, group] of feeGroups.entries()) {
      let paid = paidByType.get(group.feeType) ?? 0;
      for (const period of periods) {
        if ((period.semester ?? period.year) > currentPeriod) break;
        const yearlyFee = group.fees[period.year - 1] ?? 0;
        const periodFee = period.semester ? yearlyFee / 2 : yearlyFee;
        const deduct = Math.min(paid, periodFee);
        paid -= deduct;
        rows.push({
          feeType: group.feeType,
          period: period.label,
          periodOrder: period.semester ?? period.year,
          feeTypeOrder,
          total: periodFee,
          pending: periodFee - deduct,
        });
      }
    }
    return rows.sort(
      (a, b) =>
        b.periodOrder - a.periodOrder || a.feeTypeOrder - b.feeTypeOrder,
    );
  }, [selectedStudent, studentReceipts]);
  const amountMax = useMemo(
    () =>
      selectedStudent
        ? feeStatusRows
            .filter((row) => row.feeType === feeType)
            .reduce((sum, row) => sum + row.pending, 0)
        : undefined,
    [feeStatusRows, feeType, selectedStudent],
  );
  const feeStatusPeriodLabel =
    selectedStudent?.course_duration_type === "semester" ? "Semester" : "Term";

  useEffect(() => {
    if (amountMax !== undefined && amount > amountMax) {
      setAmount(amountMax);
    }
  }, [amount, amountMax]);

  // Wait for the letterhead image to load, then open the print dialog. The
  // browser/webview reprints whatever is in #receipt-print at print time.
  useEffect(() => {
    if (!printReceipt || !printAfterRenderRef.current) return;
    printAfterRenderRef.current = false;
    const img = document.querySelector<HTMLImageElement>("#receipt-print img");
    if (img && !img.complete) {
      const done = () => {
        img.removeEventListener("load", done);
        img.removeEventListener("error", done);
        window.print();
      };
      img.addEventListener("load", done);
      img.addEventListener("error", done);
      return;
    }
    // Defer one frame so the template is painted before printing.
    requestAnimationFrame(() => window.print());
  }, [printReceipt]);

  function handlePrint(receipt: PrintableReceipt) {
    if (!selectedStudent) {
      toast.error("Select a student first");
      return;
    }
    printAfterRenderRef.current = true;
    setPrintReceipt(receipt);
  }

  function updateAmount(value: string) {
    const nextAmount = Number(value);
    if (!Number.isFinite(nextAmount)) {
      setAmount(0);
      return;
    }
    setAmount(
      amountMax === undefined ? nextAmount : Math.min(nextAmount, amountMax),
    );
  }

  async function submit(event: React.SubmitEvent) {
    event.preventDefault();
    if (!studentId) {
      toast.error("Select a student");
      return;
    }
    if (requiresRef && !reference) {
      toast.error("Remarks are required for non-cash payments");
      return;
    }
    if (amountMax !== undefined && amountMax <= 0) {
      toast.error("No pending fee found for the selected fee type");
      return;
    }
    if (amountMax !== undefined && amount > amountMax) {
      toast.error(`Amount paid cannot exceed ${money(amountMax)}`);
      return;
    }
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticReceipt: StudentReceipt = {
      optimistic_id: optimisticId,
      receipt_no: receiptNo,
      receipt_date: receiptDate,
      fee_type: feeType,
      amount_paid: amount,
      payment_mode: mode,
      reference_no: reference,
    };
    setIsSaving(true);
    setStudentReceipts((current) => [optimisticReceipt, ...current]);

    try {
      const savedReceipt = await api<StudentReceipt>("/receipts", token, {
        method: "POST",
        body: JSON.stringify({
          receipt_no: receiptNo,
          student_id: studentId,
          receipt_date: receiptDate,
          fee_type: feeType,
          amount_paid: amount,
          payment_mode: mode,
          reference_no: reference,
        }),
      });
      cacheReceipt(savedReceipt).catch(() => {});
      setStudentReceipts((current) =>
        current.map((receipt) =>
          receipt.optimistic_id === optimisticId ? savedReceipt : receipt,
        ),
      );
      toast.success(`Saved Receipt #${savedReceipt.receipt_no}`);
      handlePrint(savedReceipt);
      setReceiptNo("");
      setGeneratedReceiptNo("");
      void loadNextReceiptNo();
    } catch (error) {
      setStudentReceipts((current) =>
        current.filter((receipt) => receipt.optimistic_id !== optimisticId),
      );
      toast.error(error instanceof Error ? error.message : "Receipt failed");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Fee Receipt No.</Label>
                <div className="flex gap-2">
                  <Input
                    required
                    inputMode="numeric"
                    value={receiptNo}
                    onChange={(e) => setReceiptNo(e.currentTarget.value)}
                  />
                  {generatedReceiptNo && receiptNo !== generatedReceiptNo && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Reset receipt number"
                      aria-label="Reset receipt number"
                      onClick={() => setReceiptNo(generatedReceiptNo)}
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Receipt date</Label>
                <Input
                  type="date"
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.currentTarget.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(10rem,13rem)_minmax(10rem,13rem)]">
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
                        <span>
                          {selectedCourse.name}
                          <span className="ml-1.5 text-muted-foreground">
                            (
                            {
                              allowedBranches.find(
                                (branch) =>
                                  branch.id === selectedCourse.branch_id,
                              )?.name
                            }
                            )
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          All courses
                        </span>
                      )}
                      <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-auto min-w-(--radix-popover-trigger-width) p-0"
                    align="start"
                  >
                    <div className="border-b p-1">
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                          !courseId && "bg-accent",
                        )}
                        onClick={() => {
                          setCourseId("");
                          setCourseOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "size-4 shrink-0",
                            !courseId ? "opacity-100" : "opacity-0",
                          )}
                        />
                        All courses
                      </button>
                    </div>
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
                                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                                  courseId === course.id && "bg-accent",
                                )}
                                onClick={() => {
                                  setCourseId(course.id);
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
                                {course.name}
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
                <Label>Student Name</Label>
                <Popover open={studentOpen} onOpenChange={setStudentOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={studentOpen}
                      className="w-full justify-between font-normal"
                    >
                      {selectedStudent ? (
                        <span className="truncate">
                          {selectedStudent.student_name}
                          {!courseId && (
                            <span className="ml-1.5 text-muted-foreground">
                              ({selectedStudent.course_name})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          Select student name
                        </span>
                      )}
                      <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-(--radix-popover-trigger-width) p-0"
                    align="start"
                  >
                    <div className="border-b p-2">
                      <Input
                        value={studentSearch}
                        placeholder="Search student"
                        onChange={(e) =>
                          setStudentSearch(e.currentTarget.value)
                        }
                      />
                    </div>
                    <div className="max-h-72 overflow-y-auto p-1">
                      {visibleStudents.length === 0 ? (
                        <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                          No students found
                        </div>
                      ) : (
                        visibleStudents.map((student) => (
                          <button
                            key={student.id}
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                              studentId === student.id && "bg-accent",
                            )}
                            onClick={() => {
                              setStudentId(student.id);
                              setStudentOpen(false);
                              setStudentSearch("");
                            }}
                          >
                            <Check
                              className={cn(
                                "size-4 shrink-0",
                                studentId === student.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {student.form_no} - {student.student_name}
                              {!courseId && (
                                <span className="ml-1.5 text-muted-foreground">
                                  ({student.course_name})
                                </span>
                              )}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Find students from</Label>
                <Select
                  value={yearFilter}
                  onValueChange={setYearFilter}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All years" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">All years</SelectItem>
                      {availableYears.length === 0 ? (
                        <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                          No results found
                        </div>
                      ) : (
                        availableYears.map((year) => (
                          <SelectItem key={year} value={String(year)}>
                            {formatCourseYear(year)}
                          </SelectItem>
                        ))
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Current semester/term</Label>
                <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
                  {selectedStudent && selectedStudentCurrentPeriod ? (
                    <>
                      <span>
                        {formatCoursePeriod(
                          selectedStudent,
                          selectedStudentCurrentPeriod,
                        )}
                      </span>
                      {selectedStudentCurrentYear ? (
                        <span className="text-muted-foreground">
                          ({formatCourseYear(selectedStudentCurrentYear)})
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      Select student
                    </span>
                  )}
                </div>
              </div>
            </div>

            {previewCourse?.letterhead && (
              <div className="flex flex-col gap-2">
                <Label>Letterhead</Label>
                <img
                  src={letterheadSrc(previewCourse.letterhead)}
                  alt="Letterhead preview"
                  className="max-h-40 w-full rounded-md border object-contain"
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div className="flex flex-col gap-2">
                <Label>Fee type</Label>
                <Select
                  value={feeType}
                  onValueChange={(value) => setFeeType(value as FeeType)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(feeTypes as readonly FeeType[]).length === 0 ? (
                        <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                          No results found
                        </div>
                      ) : (
                        feeTypes.map((item) => (
                          <SelectItem key={item} value={item}>
                            {item}
                          </SelectItem>
                        ))
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Amount paid</Label>
                <Input
                  required
                  type="number"
                  min="1"
                  max={amountMax}
                  value={amount}
                  onChange={(e) => updateAmount(e.currentTarget.value)}
                />
                {amountMax !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    Max {money(amountMax)}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label>Payment mode</Label>
                <Select
                  value={mode}
                  onValueChange={(value) => setMode(value as PaymentMode)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {paymentModes.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>{requiresRef ? "Remarks *" : "Remarks"}</Label>
                <Input
                  value={reference}
                  required={requiresRef}
                  onChange={(e) => setReference(e.currentTarget.value)}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button disabled={isSaving}>
                <ReceiptText className="size-4" />
                {isSaving ? "Saving..." : "Save receipt"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {selectedStudent && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Card className="p-0">
            <CardContent className="p-0">
              {studentReceipts.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No payment history found
                </p>
              ) : (
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[14%]">Receipt No</TableHead>
                      <TableHead className="w-[16%]">Date</TableHead>
                      <TableHead className="w-[13%]">Fee Type</TableHead>
                      <TableHead className="w-[12%]">Mode</TableHead>
                      <TableHead className="w-[16%] text-right">
                        Amount
                      </TableHead>
                      <TableHead className="w-[19%]">Remarks</TableHead>
                      <TableHead className="w-[10%] text-right">Print</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {studentReceipts.map((r) => (
                      <TableRow key={r.id ?? r.optimistic_id ?? r.receipt_no}>
                        <TableCell>{r.receipt_no}</TableCell>
                        <TableCell>{r.receipt_date}</TableCell>
                        <TableCell>{r.fee_type || "Tuition"}</TableCell>
                        <TableCell>{r.payment_mode}</TableCell>
                        <TableCell className="text-right">
                          {money(r.amount_paid)}
                        </TableCell>
                        <TableCell>{r.reference_no || "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Print receipt"
                            aria-label={`Print receipt ${r.receipt_no}`}
                            onClick={() =>
                              handlePrint({
                                receipt_no: r.receipt_no,
                                receipt_date: r.receipt_date,
                                fee_type: r.fee_type,
                                payment_mode: r.payment_mode,
                                amount_paid: r.amount_paid,
                                reference_no: r.reference_no,
                              })
                            }
                          >
                            <Printer className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="p-0">
            <CardContent className="p-0">
              {feeStatusRows.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No fee information available
                </p>
              ) : (
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[22%]">Fee Type</TableHead>
                      <TableHead className="w-[32%]">
                        {feeStatusPeriodLabel}
                      </TableHead>
                      <TableHead className="w-[23%] text-right">
                        Total
                      </TableHead>
                      <TableHead className="w-[23%] text-right">
                        Pending
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feeStatusRows.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row.feeType}</TableCell>
                        <TableCell>{row.period}</TableCell>
                        <TableCell className="text-right">
                          {money(row.total)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-medium",
                            row.pending > 0 && "text-destructive",
                          )}
                        >
                          {money(row.pending)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <ReceiptPrint
        student={selectedStudent}
        branch={selectedBranch}
        course={selectedStudentCourse}
        receipt={printReceipt}
        academicYearStartMonth={me.academic_year_start_month}
      />
    </div>
  );
}

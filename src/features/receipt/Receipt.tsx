import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, ReceiptText, RotateCcw } from "lucide-react";
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
import { getCourseBillingPeriods } from "@/lib/course-duration";
import { money, today } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Branch, Course, Me, PaymentMode, Student } from "@/types";

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
  const [studentReceipts, setStudentReceipts] = useState<StudentReceipt[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const requiresRef = mode !== "Cash";
  const allowedBranches =
    me.role === "admin"
      ? branches
      : branches.filter((branch) => branch.id === me.branch_id);
  const selectedCourse = courses.find((course) => course.id === courseId);
  const selectedStudent = students.find((student) => student.id === studentId);
  const visibleStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    return students.filter((student) => {
      if (courseId && student.course_id !== courseId) return false;
      if (!query) return true;
      return `${student.form_no} ${student.student_name} ${student.course_name}`
        .toLowerCase()
        .includes(query);
    });
  }, [courseId, studentSearch, students]);

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
    void loadNextReceiptNo();
  }, [token]);

  useEffect(() => {
    if (!studentId || !courseId) return;
    const student = students.find((item) => item.id === studentId);
    if (student && student.course_id !== courseId) setStudentId("");
  }, [courseId, studentId, students]);

  useEffect(() => {
    if (!studentId) {
      setStudentReceipts([]);
      return;
    }
    async function loadStudentReceipts() {
      try {
        const data = await api<StudentReceipt[]>(
          `/receipts?student_id=${studentId}`,
          token,
        );
        setStudentReceipts(data);
      } catch {
        setStudentReceipts([]);
      }
    }
    void loadStudentReceipts();
  }, [studentId, token, refreshKey]);

  const feeStatusRows = useMemo(() => {
    if (!selectedStudent) return [];
    const feeFields = [
      selectedStudent.fee_year_1,
      selectedStudent.fee_year_2,
      selectedStudent.fee_year_3,
      selectedStudent.fee_year_4,
    ];

    const admission = new Date(selectedStudent.admission_date);
    const now = new Date();
    const startMonth = me.academic_year_start_month;
    const admissionAcademicYear =
      admission.getMonth() + 1 >= startMonth
        ? admission.getFullYear()
        : admission.getFullYear() - 1;
    const currentAcademicYear =
      now.getMonth() + 1 >= startMonth
        ? now.getFullYear()
        : now.getFullYear() - 1;
    const currentYear = currentAcademicYear - admissionAcademicYear + 1;

    const paidByType = new Map<string, number>();
    for (const r of studentReceipts) {
      const key = r.fee_type || "Tuition";
      paidByType.set(key, (paidByType.get(key) ?? 0) + r.amount_paid);
    }
    const rows: {
      feeType: string;
      year: number;
      sem: string;
      total: number;
      pending: number;
    }[] = [];
    let tuitionPaid = paidByType.get("Tuition") ?? 0;
    for (const period of getCourseBillingPeriods(selectedStudent)) {
      if (period.year > currentYear) break;
      const yearlyFee = feeFields[period.year - 1] ?? 0;
      const periodFee = period.semester ? yearlyFee / 2 : yearlyFee;
      const deduct = Math.min(tuitionPaid, periodFee);
      tuitionPaid -= deduct;
      rows.push({
        feeType: "Tuition",
        year: period.year,
        sem: period.semester ? period.label : "—",
        total: periodFee,
        pending: periodFee - deduct,
      });
    }
    const otherPaid = paidByType.get("Other") ?? 0;
    const otherTotal = studentReceipts
      .filter((r) => r.fee_type === "Other")
      .reduce((s, r) => s + r.amount_paid, 0);
    if (otherTotal > 0) {
      rows.push({
        feeType: "Other",
        year: 0,
        sem: "—",
        total: otherTotal,
        pending: otherTotal - otherPaid,
      });
    }
    return rows;
  }, [selectedStudent, studentReceipts, me.academic_year_start_month]);
  const amountMax = useMemo(
    () =>
      selectedStudent
        ? feeStatusRows.reduce((sum, row) => sum + row.pending, 0)
        : undefined,
    [feeStatusRows, selectedStudent],
  );

  useEffect(() => {
    if (amountMax !== undefined && amount > amountMax) {
      setAmount(amountMax);
    }
  }, [amount, amountMax]);

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
      setStudentReceipts((current) =>
        current.map((receipt) =>
          receipt.optimistic_id === optimisticId ? savedReceipt : receipt,
        ),
      );
      toast.success("Receipt saved");
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    <div className="flex divide-x">
                      {allowedBranches.map((branch) => {
                        const branchCourses = courses.filter(
                          (course) => course.branch_id === branch.id,
                        );
                        if (branchCourses.length === 0) return null;
                        return (
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
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Student name</Label>
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
            </div>

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
                      {feeTypes.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
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
                      <TableHead className="w-[15%]">Receipt No</TableHead>
                      <TableHead className="w-[18%]">Date</TableHead>
                      <TableHead className="w-[15%]">Fee Type</TableHead>
                      <TableHead className="w-[14%]">Mode</TableHead>
                      <TableHead className="w-[18%] text-right">Amount</TableHead>
                      <TableHead className="w-[20%]">Remarks</TableHead>
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
                      <TableHead className="w-[16%]">Year</TableHead>
                      <TableHead className="w-[16%]">Sem</TableHead>
                      <TableHead className="w-[23%] text-right">Total</TableHead>
                      <TableHead className="w-[23%] text-right">Pending</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feeStatusRows.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row.feeType}</TableCell>
                        <TableCell>{row.year || "—"}</TableCell>
                        <TableCell>{row.sem}</TableCell>
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
    </div>
  );
}

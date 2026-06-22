import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronsUpDown,
  Printer,
  Save,
  Search,
  UserX,
} from "lucide-react";
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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CourseGroups } from "@/components/app/CourseGroups";
import { StudentPhotoField } from "@/components/app/StudentPhotoField";
import { api } from "@/lib/api";
import {
  formatCoursePeriod,
  formatCourseYear,
  formatPeriodLabel,
  getCourseDuration,
  getCurrentCourseYear,
} from "@/lib/course-duration";
import { admissionYear, money } from "@/lib/format";
import { printPage } from "@/lib/print";
import { cn } from "@/lib/utils";
import type { Branch, Course, Me, PaymentMode, Student } from "@/types";
import {
  AdmissionPrint,
  type PrintableAdmission,
} from "@/features/admission/AdmissionPrint";

const categories = ["General", "SC", "ST", "OBC", "Others"];
const genders = ["Male", "Female"];

type StudentForm = {
  form_no: string;
  admission_date: string;
  branch_id: string;
  course_id: string;
  current_course_period: number;
  surname: string;
  student_name: string;
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
};

type StudentReceipt = {
  id: string;
  receipt_no: string | number;
  receipt_date: string;
  fee_type: string;
  payment_mode: PaymentMode;
  amount_paid: number;
  reference_no: string | null;
  cancelled: boolean;
};

/// The stored student_name is the combined "surname name father" line. For
/// students admitted before the parts were stored separately, surname and
/// father_name are empty and the combined name goes in the middle field.
function splitStudentName(student: Student) {
  let name = student.student_name;
  const surname = student.surname ?? "";
  const father = student.father_name ?? "";
  if (surname && name.startsWith(`${surname} `)) {
    name = name.slice(surname.length + 1);
  }
  if (father && name.endsWith(` ${father}`)) {
    name = name.slice(0, -(father.length + 1));
  }
  return { surname, name, father };
}

function toForm(student: Student): StudentForm {
  const { surname, name, father } = splitStudentName(student);
  return {
    form_no: student.form_no,
    admission_date: student.admission_date,
    branch_id: student.branch_id,
    course_id: student.course_id,
    current_course_period: student.current_course_period,
    surname,
    student_name: name,
    father_name: father,
    category: student.category,
    religion: student.religion,
    caste: student.caste,
    gender: student.gender,
    aadhar: student.aadhar,
    address: student.address,
    district: student.district,
    taluka: student.taluka,
    pincode: student.pincode,
    student_phone: student.student_phone,
    parent_phone: student.parent_phone,
    photo: student.photo,
    fee_year_1: student.fee_year_1,
    fee_year_2: student.fee_year_2,
    fee_year_3: student.fee_year_3,
    fee_year_4: student.fee_year_4,
    tuition_fee_year_1: student.tuition_fee_year_1,
    tuition_fee_year_2: student.tuition_fee_year_2,
    tuition_fee_year_3: student.tuition_fee_year_3,
    tuition_fee_year_4: student.tuition_fee_year_4,
    other_fee_year_1: student.other_fee_year_1,
    other_fee_year_2: student.other_fee_year_2,
    other_fee_year_3: student.other_fee_year_3,
    other_fee_year_4: student.other_fee_year_4,
  };
}

function feeField(type: "fee" | "tuition" | "other", year: number) {
  return `${
    type === "fee" ? "fee" : `${type}_fee`
  }_year_${year}` as keyof StudentForm;
}

function numberValue(value: string) {
  // Fees are whole rupees only.
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function Students({
  token,
  me,
  refreshKey,
  branches,
  courses,
  onSaved,
}: {
  token: string;
  me: Me;
  refreshKey: number;
  branches: Branch[];
  courses: Course[];
  onSaved: () => void;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [studentReceipts, setStudentReceipts] = useState<StudentReceipt[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [currentYearValue, setCurrentYearValue] = useState("");
  const [courseOpen, setCourseOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [form, setForm] = useState<StudentForm | null>(null);
  const [detailsCourseOpen, setDetailsCourseOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelPassword, setCancelPassword] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [printSnapshot, setPrintSnapshot] = useState<PrintableAdmission | null>(
    null,
  );
  const printAfterRenderRef = useRef(false);

  const branchCourseGroups = branches
    .map((branch) => ({
      branch,
      branchCourses: courses.filter((course) => course.branch_id === branch.id),
    }))
    .filter((group) => group.branchCourses.length > 0);
  // Students cannot move between branches, so the course picker on the detail
  // page only offers the student's own branch.
  const detailsCourseGroups = branchCourseGroups.filter(
    (group) => group.branch.id === form?.branch_id,
  );
  const selectedCourse = courses.find((course) => course.id === courseId);
  const selectedBranch = branches.find(
    (branch) => branch.id === selectedCourse?.branch_id,
  );
  const detailsCourse = courses.find((course) => course.id === form?.course_id);
  const detailsBranch = branches.find(
    (branch) => branch.id === detailsCourse?.branch_id,
  );
  const currentYears = useMemo(
    () =>
      selectedCourse
        ? Array.from(
            { length: getCourseDuration(selectedCourse).totalYears },
            (_, index) => String(index + 1),
          )
        : [],
    [selectedCourse],
  );
  const canShowTable = Boolean(courseId && currentYearValue);
  const tableStudents = useMemo(() => {
    if (!canShowTable) return [];
    return students.filter((student) => {
      if (student.course_id !== courseId) return false;
      if (getCurrentCourseYear(student) !== Number(currentYearValue)) {
        return false;
      }
      return true;
    });
  }, [canShowTable, courseId, currentYearValue, students]);
  const visibleStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tableStudents;
    return tableStudents.filter((student) =>
      `${student.form_no} ${student.student_name} ${student.branch_name}`
        .toLowerCase()
        .includes(query),
    );
  }, [search, tableStudents]);
  const searchDisabled = !canShowTable || tableStudents.length === 0;
  const detailPeriods = useMemo(
    () =>
      detailsCourse
        ? Array.from(
            { length: getCourseDuration(detailsCourse).totalSemesters },
            (_, index) => index + 1,
          )
        : [],
    [detailsCourse],
  );
  // Fee rows only run for the course's actual number of years (no_of_sems / 2),
  // capped at the four stored fee_year_* columns.
  const detailYears = useMemo(
    () =>
      detailsCourse
        ? Array.from(
            {
              length: Math.min(getCourseDuration(detailsCourse).totalYears, 4),
            },
            (_, index) => index + 1,
          )
        : [],
    [detailsCourse],
  );
  const isCancelled = selectedStudent?.admission_cancelled ?? false;
  const isAdmin = me.role === "admin";
  const canEditStudent = isAdmin && !isCancelled;

  useEffect(() => {
    async function loadStudents() {
      try {
        setStudents(
          await api<Student[]>(
            "/students?include_cancelled=true",
            token,
          ),
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Unable to load students",
        );
      }
    }

    if (me.can_students) void loadStudents();
  }, [me.can_students, refreshKey, token]);

  useEffect(() => {
    if (!currentYearValue || currentYears.includes(currentYearValue)) return;
    setCurrentYearValue("");
  }, [currentYearValue, currentYears]);

  useEffect(() => {
    if (!selectedStudent) {
      setStudentReceipts([]);
      setReceiptsLoading(false);
      return;
    }

    let stale = false;
    setReceiptsLoading(true);
    api<StudentReceipt[]>(
      `/receipts?student_id=${encodeURIComponent(selectedStudent.id)}`,
      token,
    )
      .then((data) => {
        if (!stale) setStudentReceipts(data);
      })
      .catch((error) => {
        if (stale) return;
        setStudentReceipts([]);
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to load payment history",
        );
      })
      .finally(() => {
        if (!stale) setReceiptsLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [selectedStudent, token, refreshKey]);

  // When the student list reloads (global refresh), pick up the latest record
  // for the open editor — but never clobber edits in progress: the form is
  // only re-seeded if it still matches the record it was loaded from.
  useEffect(() => {
    if (!selectedStudent) return;
    const latest = students.find(
      (student) => student.id === selectedStudent.id,
    );
    if (!latest || latest === selectedStudent) return;
    const pristine =
      form !== null &&
      JSON.stringify(form) === JSON.stringify(toForm(selectedStudent));
    setSelectedStudent(latest);
    if (pristine) setForm(toForm(latest));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students]);

  function openStudent(student: Student) {
    setSelectedStudent(student);
    setForm(toForm(student));
  }

  // Wait for the letterhead image to load, then open the print dialog. Mirrors
  // the admission print flow: the webview prints whatever is in #admission-print.
  useEffect(() => {
    if (!printSnapshot || !printAfterRenderRef.current) return;
    printAfterRenderRef.current = false;
    const img = document.querySelector<HTMLImageElement>(
      "#admission-print img",
    );
    if (img && !img.complete) {
      const done = () => {
        img.removeEventListener("load", done);
        img.removeEventListener("error", done);
        void printPage();
      };
      img.addEventListener("load", done);
      img.addEventListener("error", done);
      return;
    }
    requestAnimationFrame(() => void printPage());
  }, [printSnapshot]);

  function printAdmissionForm() {
    if (!selectedStudent || !form) return;
    printAfterRenderRef.current = true;
    setPrintSnapshot({
      form_no: selectedStudent.form_no,
      admission_date: form.admission_date,
      surname: form.surname,
      student_name: form.student_name,
      father_name: form.father_name,
      category: form.category,
      religion: form.religion,
      caste: form.caste,
      gender: form.gender,
      aadhar: form.aadhar,
      address: form.address,
      district: form.district,
      taluka: form.taluka,
      pincode: form.pincode,
      student_phone: form.student_phone,
      parent_phone: form.parent_phone,
      photo: form.photo,
    });
  }

  function updateForm<K extends keyof StudentForm>(
    field: K,
    value: StudentForm[K],
  ) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateCourse(nextCourseId: string) {
    const nextCourse = courses.find((course) => course.id === nextCourseId);
    if (!nextCourse) return;
    setForm((current) => {
      if (!current) return current;
      // The branch never changes on edit; only same-branch courses are offered.
      if (nextCourse.branch_id !== current.branch_id) return current;
      const maxPeriod = getCourseDuration(nextCourse).totalSemesters;
      return {
        ...current,
        course_id: nextCourse.id,
        current_course_period: Math.min(
          current.current_course_period,
          maxPeriod,
        ),
      };
    });
  }

  function updateFee(
    year: number,
    type: "fee" | "tuition" | "other",
    value: string,
  ) {
    if (isFeeYearLocked(year)) return;
    const field = feeField(type, year);
    updateForm(field, numberValue(value));
  }

  function isFeeYearLocked(year: number) {
    if (!selectedStudent || !form || isCancelled) return false;
    const storedYear = Math.max(
      Math.ceil(selectedStudent.current_course_period / 2),
      1,
    );
    const requestedYear = Math.max(
      Math.ceil(form.current_course_period / 2),
      1,
    );
    return year < Math.max(storedYear, requestedYear);
  }

  function feeTotalValid(year: number) {
    if (!form) return true;
    const fee = Number(form[feeField("fee", year)]);
    const tuition = Number(form[feeField("tuition", year)]);
    const other = Number(form[feeField("other", year)]);
    return Math.abs(tuition + other - fee) <= 0.01;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedStudent || !form) return;
    if (!isAdmin) {
      toast.error("Admin access required");
      return;
    }
    for (let year = 1; year <= 4; year += 1) {
      if (!feeTotalValid(year)) {
        toast.error(
          `Tuition fee and other fee must add up to year ${year} fee`,
        );
        return;
      }
    }

    setSaving(true);
    try {
      const fullName = [form.surname, form.student_name, form.father_name]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");
      const saved = await api<Student>(
        `/students/${selectedStudent.id}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({ ...form, student_name: fullName }),
        },
      );
      setStudents((current) =>
        current.map((student) => (student.id === saved.id ? saved : student)),
      );
      setSelectedStudent(saved);
      setForm(toForm(saved));
      toast.success(`Updated Student #${saved.form_no}`);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save");
    } finally {
      setSaving(false);
    }
  }

  async function confirmCancelAdmission() {
    if (!selectedStudent) return;
    if (!cancelPassword.trim()) {
      toast.error("Enter the admin password to cancel admission");
      return;
    }
    setCancelling(true);
    try {
      const saved = await api<Student>(
        `/students/${selectedStudent.id}/cancel`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ password: cancelPassword }),
        },
      );
      setStudents((current) =>
        current.map((student) => (student.id === saved.id ? saved : student)),
      );
      setSelectedStudent(saved);
      setForm(toForm(saved));
      setCancelOpen(false);
      setCancelPassword("");
      toast.success(`Cancelled admission #${saved.form_no}`);
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to cancel admission",
      );
    } finally {
      setCancelling(false);
    }
  }

  if (!me.can_students) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Students management is not available for this user.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (selectedStudent && form) {
    return (
      <form onSubmit={submit} className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSelectedStudent(null);
              setForm(null);
            }}
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            {isCancelled && <Badge variant="destructive">Cancelled</Badge>}
            {!isAdmin && <Badge variant="secondary">Read only</Badge>}
            <Button
              type="button"
              variant="outline"
              onClick={printAdmissionForm}
            >
              <Printer className="size-4" />
              Print admission form
            </Button>
            {isAdmin && (
              <Button type="submit" disabled={saving || isCancelled}>
                <Save className="size-4" />
                {saving ? "Saving..." : "Save changes"}
              </Button>
            )}
            {isAdmin && (
              <Button
                type="button"
                variant="destructive"
                disabled={isCancelled || cancelling}
                onClick={() => setCancelOpen(true)}
              >
                <UserX className="size-4" />
                Cancel admission
              </Button>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-5">
            <fieldset
              disabled={!canEditStudent || saving}
              className="contents disabled:opacity-100"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-2">
                  <Label>Form No.</Label>
                  {/* Issued once at admission; never editable. */}
                  <Input value={form.form_no} readOnly disabled />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Admission date</Label>
                  <Input
                    type="date"
                    required
                    min="1900-01-01"
                    max="2100-12-31"
                    value={form.admission_date}
                    onChange={(e) =>
                      updateForm("admission_date", e.currentTarget.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-2 lg:col-span-2">
                  <Label>Course</Label>
                  <Popover
                    open={detailsCourseOpen}
                    onOpenChange={setDetailsCourseOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={detailsCourseOpen}
                        className="w-full justify-between font-normal"
                      >
                        {detailsCourse ? (
                          <span className="truncate">
                            {detailsCourse.name}
                            <span className="ml-1.5 text-muted-foreground">
                              ({detailsBranch?.name})
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
                      className="w-auto p-0"
                      align="start"
                    >
                      <CourseGroups
                        groups={detailsCourseGroups}
                        selectedCourseId={form.course_id}
                        onSelect={(nextCourseId) => {
                          updateCourse(nextCourseId);
                          setDetailsCourseOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-2">
                  <Label>Current period</Label>
                  <Select
                    value={String(form.current_course_period)}
                    onValueChange={(value) =>
                      updateForm("current_course_period", Number(value))
                    }
                    disabled={detailPeriods.length === 0}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {detailPeriods.map((period) => (
                          <SelectItem key={period} value={String(period)}>
                            {detailsCourse
                              ? formatPeriodLabel(
                                  detailsCourse.duration_type,
                                  period,
                                )
                              : period}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Current year</Label>
                  <Input
                    disabled
                    value={formatCourseYear(
                      Math.max(Math.ceil(form.current_course_period / 2), 1),
                    )}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Branch</Label>
                  <Input disabled value={detailsBranch?.name ?? ""} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Status</Label>
                  <Input
                    disabled
                    value={
                      selectedStudent.admission_cancelled_at
                        ? `Cancelled on ${selectedStudent.admission_cancelled_at.slice(0, 10)}`
                        : "Active"
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[auto_1fr]">
                <div className="sm:row-span-3">
                  <StudentPhotoField
                    value={form.photo}
                    onChange={(photo) => updateForm("photo", photo)}
                    disabled={!canEditStudent || saving}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <Label>Surname</Label>
                    <Input
                      value={form.surname}
                      onChange={(e) =>
                        updateForm("surname", e.currentTarget.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Student name</Label>
                    <Input
                      required
                      value={form.student_name}
                      onChange={(e) =>
                        updateForm("student_name", e.currentTarget.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Father's name</Label>
                    <Input
                      value={form.father_name}
                      onChange={(e) =>
                        updateForm("father_name", e.currentTarget.value)
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <div className="flex flex-col gap-2">
                    <Label>Category</Label>
                    <Select
                      value={form.category}
                      onValueChange={(value) => updateForm("category", value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {categories.map((category) => (
                            <SelectItem key={category} value={category}>
                              {category}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Religion</Label>
                    <Input
                      value={form.religion}
                      onChange={(e) =>
                        updateForm("religion", e.currentTarget.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Caste</Label>
                    <Input
                      value={form.caste}
                      onChange={(e) =>
                        updateForm("caste", e.currentTarget.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Gender</Label>
                    <Select
                      value={form.gender}
                      onValueChange={(value) => updateForm("gender", value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {genders.map((gender) => (
                            <SelectItem key={gender} value={gender}>
                              {gender}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <div className="flex flex-col gap-2">
                    <Label>Aadhar No.</Label>
                    <Input
                      value={form.aadhar}
                      onChange={(e) =>
                        updateForm("aadhar", e.currentTarget.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Student Phone</Label>
                    <Input
                      value={form.student_phone}
                      onChange={(e) =>
                        updateForm("student_phone", e.currentTarget.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Parent Phone</Label>
                    <Input
                      value={form.parent_phone}
                      onChange={(e) =>
                        updateForm("parent_phone", e.currentTarget.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Admission year</Label>
                    <Input disabled value={admissionYear(selectedStudent)} />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label>Address</Label>
                <Textarea
                  value={form.address}
                  onChange={(e) => updateForm("address", e.currentTarget.value)}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label>District</Label>
                  <Input
                    value={form.district}
                    onChange={(e) =>
                      updateForm("district", e.currentTarget.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Taluka</Label>
                  <Input
                    value={form.taluka}
                    onChange={(e) =>
                      updateForm("taluka", e.currentTarget.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Pincode</Label>
                  <Input
                    inputMode="numeric"
                    value={form.pincode}
                    onChange={(e) =>
                      updateForm("pincode", e.currentTarget.value)
                    }
                  />
                </div>
              </div>
            </fieldset>
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardContent className="p-0">
            <Table className="min-w-[900px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Year</TableHead>
                  <TableHead className="text-right">Yearly fee</TableHead>
                  <TableHead className="text-right">Tuition fee</TableHead>
                  <TableHead className="text-right">Other fee</TableHead>
                  <TableHead className="w-40 text-right">Check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailYears.map((year) => {
                  const total = Number(form[feeField("fee", year)]);
                  const valid = feeTotalValid(year);
                  const locked = isFeeYearLocked(year);
                  return (
                    <TableRow key={year}>
                      <TableCell className="font-medium">
                        {formatCourseYear(year)}
                      </TableCell>
                      {(["fee", "tuition", "other"] as const).map((type) => (
                        <TableCell key={type}>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            disabled={!canEditStudent || locked}
                            value={Number(form[feeField(type, year)])}
                            onChange={(e) =>
                              updateFee(year, type, e.currentTarget.value)
                            }
                            className="text-right"
                          />
                        </TableCell>
                      ))}
                      <TableCell
                        className={cn(
                          "text-right text-sm",
                          valid ? "text-muted-foreground" : "text-destructive",
                        )}
                      >
                        {locked
                          ? `Locked - ${money(total)}`
                          : valid
                            ? money(total)
                            : "Split mismatch"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardHeader className="border-b p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Payment history</h2>
                <p className="text-xs text-muted-foreground">
                  Receipts recorded for this student.
                </p>
              </div>
              {receiptsLoading && (
                <span className="text-xs text-muted-foreground">Loading...</span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {receiptsLoading && studentReceipts.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Loading payment history...
              </p>
            ) : studentReceipts.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No payment history found
              </p>
            ) : (
              <Table className="min-w-[720px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Receipt No</TableHead>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead className="w-24">Fee Type</TableHead>
                    <TableHead className="w-20">Mode</TableHead>
                    <TableHead className="w-28 text-right">Amount</TableHead>
                    <TableHead>Remarks</TableHead>
                    <TableHead className="w-28 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {studentReceipts.map((receipt) => (
                    <TableRow
                      key={receipt.id}
                      className={cn(receipt.cancelled && "opacity-60")}
                    >
                      <TableCell
                        className={cn(
                          "font-medium",
                          receipt.cancelled && "line-through",
                        )}
                      >
                        {receipt.receipt_no}
                      </TableCell>
                      <TableCell>{receipt.receipt_date}</TableCell>
                      <TableCell>{receipt.fee_type || "Tuition"}</TableCell>
                      <TableCell>{receipt.payment_mode}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right",
                          receipt.cancelled && "line-through",
                        )}
                      >
                        {money(receipt.amount_paid)}
                      </TableCell>
                      <TableCell>
                        <span
                          className="block max-w-56 truncate"
                          title={receipt.reference_no || undefined}
                        >
                          {receipt.reference_no || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {receipt.cancelled ? (
                          <Badge variant="destructive">Cancelled</Badge>
                        ) : (
                          <Badge variant="secondary">Recorded</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <AlertDialog
          open={cancelOpen}
          onOpenChange={(open) => {
            setCancelOpen(open);
            if (!open) setCancelPassword("");
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel Admission</AlertDialogTitle>
              <AlertDialogDescription>
                Cancel admission for {selectedStudent.student_name}? This sets
                all fee amounts to 0 and removes the student from outstanding,
                promotion, and fee receipt student lists.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cancel-admin-password">Admin password</Label>
              <Input
                id="cancel-admin-password"
                type="password"
                autoComplete="current-password"
                value={cancelPassword}
                disabled={cancelling}
                onChange={(event) =>
                  setCancelPassword(event.currentTarget.value)
                }
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cancelling}>Back</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={cancelling || cancelPassword.trim().length === 0}
                onClick={(event) => {
                  event.preventDefault();
                  void confirmCancelAdmission();
                }}
              >
                {cancelling ? "Cancelling..." : "Cancel admission"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AdmissionPrint
          admission={printSnapshot}
          course={detailsCourse}
          branch={detailsBranch}
        />
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
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
                className="w-auto p-0"
                align="start"
              >
                <CourseGroups
                  groups={branchCourseGroups}
                  selectedCourseId={courseId}
                  onSelect={(nextCourseId) => {
                    setCourseId(nextCourseId);
                    setCurrentYearValue("");
                    setCourseOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Current Year</Label>
            <Select
              value={currentYearValue}
              onValueChange={setCurrentYearValue}
              disabled={!courseId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {currentYears.length === 0 ? (
                    <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                      No results found
                    </div>
                  ) : (
                    currentYears.map((year) => (
                      <SelectItem key={year} value={year}>
                        {formatCourseYear(Number(year))}
                      </SelectItem>
                    ))
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 p-0">
        <CardHeader className="border-b p-4">
          <div className="flex w-full max-w-sm flex-col gap-2">
            <Label>Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                className="pl-8"
                placeholder="Form or name"
                disabled={searchDisabled}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!canShowTable ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Select course and current year to view students
            </p>
          ) : visibleStudents.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No students found
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Form</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Current Period</TableHead>
                  <TableHead>Admission Year</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleStudents.map((student) => (
                  <TableRow
                    key={student.id}
                    className="cursor-pointer transition-colors hover:bg-muted/60"
                    onClick={() => openStudent(student)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openStudent(student);
                      }
                    }}
                  >
                    <TableCell>{student.form_no}</TableCell>
                    <TableCell className="font-medium">
                      {student.student_name}
                    </TableCell>
                    <TableCell>{student.branch_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{student.course_name}</Badge>
                    </TableCell>
                    <TableCell>
                      {formatCoursePeriod(
                        student,
                        student.current_course_period,
                      )}
                    </TableCell>
                    <TableCell>{admissionYear(student)}</TableCell>
                    <TableCell>
                      {student.admission_cancelled ? (
                        <Badge variant="destructive">Cancelled</Badge>
                      ) : (
                        <Badge variant="outline">Active</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

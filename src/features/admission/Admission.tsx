import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Printer,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { StudentPhotoField } from "@/components/app/StudentPhotoField";
import { api, previewFormNo } from "@/lib/api";
import { getCourseDuration } from "@/lib/course-duration";
import { money, today } from "@/lib/format";
import { printPage } from "@/lib/print";
import { cn } from "@/lib/utils";
import type { Branch, Course, Me, Student } from "@/types";
import { AdmissionPrint, type PrintableAdmission } from "./AdmissionPrint";

const categories = ["General", "SC", "ST", "OBC", "Others"];

export function Admission({
  token,
  me,
  branches,
  courses,
  onSaved,
}: {
  token: string;
  me: Me;
  branches: Branch[];
  courses: Course[];
  onSaved: () => void;
}) {
  const allowedBranches =
    me.role === "admin"
      ? branches
      : branches.filter((branch) => branch.id === me.branch_id);
  const initialForm = (form_no = "") => ({
    form_no,
    admission_date: today(),
    branch_id: allowedBranches[0]?.id ?? "",
    course_id: "",
    surname: "",
    student_name: "",
    father_name: "",
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
    yearly_fee: 0,
    tuition_fee: 0,
    other_fee: 0,
  });
  const [form, setForm] = useState(initialForm);
  const [courseOpen, setCourseOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [printSnapshot, setPrintSnapshot] = useState<PrintableAdmission | null>(
    null,
  );
  const [printCourse, setPrintCourse] = useState<Course | undefined>(undefined);
  const [printBranch, setPrintBranch] = useState<Branch | undefined>(undefined);
  // Set by the "Save & print" button so the shared submit handler knows whether
  // to open the print dialog after a successful save.
  const shouldPrintRef = useRef(false);
  const printAfterRenderRef = useRef(false);
  // When a print is in flight we defer onSaved()'s global refresh until after
  // window.print() has fired, so the refetch doesn't re-render the tree out
  // from under the print dialog (which silently swallows the print).
  const refreshAfterPrintRef = useRef(false);
  const selectedCourse = courses.find(
    (course) => course.id === form.course_id,
  );
  const selectedBranch = branches.find(
    (branch) => branch.id === selectedCourse?.branch_id,
  );
  const durationValue = selectedCourse
    ? getCourseDuration(selectedCourse).label
    : "";
  const branchCourseGroups = allowedBranches
    .map((branch) => ({
      branch,
      branchCourses: courses.filter((c) => c.branch_id === branch.id),
    }))
    .filter((group) => group.branchCourses.length > 0);
  const tuitionFeeMax = Math.max(0, form.yearly_fee - form.other_fee);
  const otherFeeMax = Math.max(0, form.yearly_fee - form.tuition_fee);

  async function loadNextFormNo() {
    if (!form.branch_id) {
      setForm((current) => ({ ...current, form_no: "" }));
      return;
    }
    try {
      const next = await previewFormNo(form.branch_id, form.admission_date);
      setForm((current) => ({ ...current, form_no: next }));
    } catch {
      setForm((current) => ({ ...current, form_no: "" }));
    }
  }

  // The form number is system-generated as {branch}-{seq}-{year}; it depends
  // on the branch and the academic year of the admission date.
  useEffect(() => {
    void loadNextFormNo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.branch_id, form.admission_date]);

  // Wait for the letterhead image to load, then open the print dialog. Mirrors
  // the receipt print flow: the webview prints whatever is in #admission-print.
  useEffect(() => {
    if (!printSnapshot || !printAfterRenderRef.current) return;
    printAfterRenderRef.current = false;
    const triggerPrint = () => {
      void printPage();
      // Refresh app data only after the print dialog has opened, so the
      // refetch's re-render doesn't interfere with printing.
      if (refreshAfterPrintRef.current) {
        refreshAfterPrintRef.current = false;
        onSaved();
      }
    };
    const img = document.querySelector<HTMLImageElement>("#admission-print img");
    if (img && !img.complete) {
      const done = () => {
        img.removeEventListener("load", done);
        img.removeEventListener("error", done);
        triggerPrint();
      };
      img.addEventListener("load", done);
      img.addEventListener("error", done);
      return;
    }
    requestAnimationFrame(triggerPrint);
  }, [printSnapshot]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isSaving) return;
    const print = shouldPrintRef.current;
    shouldPrintRef.current = false;
    setIsSaving(true);
    try {
      const {
        yearly_fee,
        tuition_fee,
        other_fee,
        surname,
        student_name,
        father_name,
        ...studentForm
      } = form;
      if (!form.course_id) {
        toast.error("Select a course");
        return;
      }
      if (!form.admission_date) {
        toast.error("Select an admission date");
        return;
      }
      if (tuition_fee + other_fee !== yearly_fee) {
        toast.error("Tuition fee and other fee must add up to yearly fee");
        return;
      }
      const fullName = [surname, student_name, father_name]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");
      // Only bill the years the course actually runs.
      const totalYears = selectedCourse
        ? getCourseDuration(selectedCourse).totalYears
        : 4;
      const feeForYear = (year: number, amount: number) =>
        year <= totalYears ? amount : 0;
      const savedStudent = await api<Student>("/students", token, {
        method: "POST",
        body: JSON.stringify({
          ...studentForm,
          student_name: fullName,
          surname,
          father_name,
          fee_year_1: feeForYear(1, yearly_fee),
          fee_year_2: feeForYear(2, yearly_fee),
          fee_year_3: feeForYear(3, yearly_fee),
          fee_year_4: feeForYear(4, yearly_fee),
          tuition_fee_year_1: feeForYear(1, tuition_fee),
          tuition_fee_year_2: feeForYear(2, tuition_fee),
          tuition_fee_year_3: feeForYear(3, tuition_fee),
          tuition_fee_year_4: feeForYear(4, tuition_fee),
          other_fee_year_1: feeForYear(1, other_fee),
          other_fee_year_2: feeForYear(2, other_fee),
          other_fee_year_3: feeForYear(3, other_fee),
          other_fee_year_4: feeForYear(4, other_fee),
        }),
      });
      toast.success(`Admitted Student #${savedStudent.form_no}`);
      if (print) {
        setPrintCourse(selectedCourse);
        setPrintBranch(selectedBranch);
        setPrintSnapshot({
          // The number the backend actually assigned, not the preview.
          form_no: savedStudent.form_no,
          admission_date: form.admission_date,
          surname,
          student_name,
          father_name,
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
          yearly_fee,
          tuition_fee,
          other_fee,
        });
        printAfterRenderRef.current = true;
        refreshAfterPrintRef.current = true;
      }
      setForm(initialForm());
      void loadNextFormNo();
      // When printing, onSaved() runs after window.print() (see the print
      // effect) so the global refresh doesn't disrupt the print dialog.
      if (!print) onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Admission failed");
    } finally {
      setIsSaving(false);
    }
  }

  function updateYearlyFee(value: string) {
    // Fees are whole rupees only.
    const parsed = Math.floor(Number(value));
    const yearly_fee = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setForm((current) => ({
      ...current,
      yearly_fee,
      tuition_fee: Math.min(current.tuition_fee, yearly_fee),
      other_fee: Math.min(
        current.other_fee,
        Math.max(0, yearly_fee - Math.min(current.tuition_fee, yearly_fee)),
      ),
    }));
  }

  function updateSplitFee(field: "tuition_fee" | "other_fee", value: string) {
    const parsed = Math.floor(Number(value));
    const amount = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setForm((current) => ({
      ...current,
      [field]: Math.min(
        amount,
        Math.max(
          0,
          current.yearly_fee -
            (field === "tuition_fee"
              ? current.other_fee
              : current.tuition_fee),
        ),
      ),
    }));
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Form No.</Label>
              <Input
                value={form.form_no || "Select a course to generate"}
                readOnly
                disabled
              />
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
                  setForm({ ...form, admission_date: e.currentTarget.value })
                }
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
                              (b) => b.id === selectedCourse.branch_id,
                            )?.name
                          }
                          )
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
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                                form.course_id === course.id && "bg-accent",
                              )}
                              onClick={() => {
                                setForm({
                                  ...form,
                                  course_id: course.id,
                                  branch_id: course.branch_id,
                                });
                                setCourseOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "size-4 shrink-0",
                                  form.course_id === course.id
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
              <Label>Duration</Label>
              <Input value={durationValue} disabled />
            </div>
          </div>

          <StudentPhotoField
            value={form.photo}
            onChange={(photo) => setForm((current) => ({ ...current, photo }))}
            disabled={isSaving}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>Yearly fee</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={form.yearly_fee}
                onChange={(e) => updateYearlyFee(e.currentTarget.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Tuition fee</Label>
              <Input
                type="number"
                min="0"
                step="1"
                max={tuitionFeeMax}
                value={form.tuition_fee}
                disabled={tuitionFeeMax === 0}
                onChange={(e) =>
                  updateSplitFee("tuition_fee", e.currentTarget.value)
                }
              />
              {form.yearly_fee > 0 && (
                <p className="text-xs text-muted-foreground">
                  Max {money(tuitionFeeMax)}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label>Other fee</Label>
              <Input
                type="number"
                min="0"
                step="1"
                max={otherFeeMax}
                value={form.other_fee}
                disabled={otherFeeMax === 0}
                onChange={(e) =>
                  updateSplitFee("other_fee", e.currentTarget.value)
                }
              />
              {form.yearly_fee > 0 && (
                <p className="text-xs text-muted-foreground">
                  Max {money(otherFeeMax)}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>Surname *</Label>
              <Input
                required
                value={form.surname}
                onChange={(e) =>
                  setForm({ ...form, surname: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Student's name *</Label>
              <Input
                required
                value={form.student_name}
                onChange={(e) =>
                  setForm({ ...form, student_name: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Father's name *</Label>
              <Input
                required
                value={form.father_name}
                onChange={(e) =>
                  setForm({ ...form, father_name: e.currentTarget.value })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-2">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(category) => setForm({ ...form, category })}
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
                  setForm({ ...form, religion: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Caste</Label>
              <Input
                value={form.caste}
                onChange={(e) =>
                  setForm({ ...form, caste: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Gender</Label>
              <div className="flex h-8 items-center gap-5">
                {["Male", "Female"].map((gender) => (
                  <label
                    key={gender}
                    className="flex items-center gap-2 text-sm font-medium"
                  >
                    <input
                      type="radio"
                      name="gender"
                      value={gender}
                      checked={form.gender === gender}
                      onChange={() => setForm({ ...form, gender })}
                      className="size-4 accent-primary"
                    />
                    {gender}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>Aadhar No.</Label>
              <Input
                value={form.aadhar}
                onChange={(e) =>
                  setForm({ ...form, aadhar: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Student Phone</Label>
              <Input
                value={form.student_phone}
                onChange={(e) =>
                  setForm({ ...form, student_phone: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Parent Phone</Label>
              <Input
                value={form.parent_phone}
                onChange={(e) =>
                  setForm({ ...form, parent_phone: e.currentTarget.value })
                }
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Address</Label>
            <Textarea
              value={form.address}
              onChange={(e) =>
                setForm({ ...form, address: e.currentTarget.value })
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>District</Label>
              <Input
                value={form.district}
                onChange={(e) =>
                  setForm({ ...form, district: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Taluka</Label>
              <Input
                value={form.taluka}
                onChange={(e) =>
                  setForm({ ...form, taluka: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Pincode</Label>
              <Input
                inputMode="numeric"
                value={form.pincode}
                onChange={(e) =>
                  setForm({ ...form, pincode: e.currentTarget.value })
                }
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="submit"
              variant="outline"
              disabled={isSaving}
              onClick={() => {
                shouldPrintRef.current = false;
              }}
            >
              <UserPlus className="size-4" />
              {isSaving ? "Saving..." : "Save admission"}
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              onClick={() => {
                shouldPrintRef.current = true;
              }}
            >
              <Printer className="size-4" />
              {isSaving ? "Saving..." : "Save & print"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AdmissionPrint
        admission={printSnapshot}
        course={printCourse}
        branch={printBranch}
      />
    </form>
  );
}

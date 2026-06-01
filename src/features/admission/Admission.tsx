import { type FormEvent, useEffect, useState } from "react";
import { Check, ChevronsUpDown, RotateCcw, UserPlus } from "lucide-react";
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
import { api } from "@/lib/api";
import { cacheStudent } from "@/lib/cache";
import { getCourseDuration } from "@/lib/course-duration";
import { today } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Branch, Course, Me, Student } from "@/types";

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
    student_phone: "",
    parent_phone: "",
    yearly_fee: 0,
  });
  const [form, setForm] = useState(initialForm);
  const [generatedFormNo, setGeneratedFormNo] = useState("");
  const [courseOpen, setCourseOpen] = useState(false);
  const selectedCourse = courses.find(
    (course) => course.id === form.course_id,
  );
  const durationValue = selectedCourse
    ? getCourseDuration(selectedCourse).label
    : "";

  async function loadNextFormNo() {
    try {
      const next = await api<{ form_no: string }>(
        "/students/next-form-no",
        token,
      );
      setGeneratedFormNo(next.form_no);
      setForm((current) => ({ ...current, form_no: next.form_no }));
    } catch {
      setGeneratedFormNo("");
      setForm((current) => ({ ...current, form_no: "" }));
    }
  }

  useEffect(() => {
    void loadNextFormNo();
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const { yearly_fee, surname, student_name, father_name, ...studentForm } =
        form;
      const fullName = [surname, student_name, father_name]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");
      const savedStudent = await api<Student>("/students", token, {
        method: "POST",
        body: JSON.stringify({
          ...studentForm,
          student_name: fullName,
          fee_year_1: yearly_fee,
          fee_year_2: yearly_fee,
          fee_year_3: yearly_fee,
          fee_year_4: yearly_fee,
        }),
      });
      cacheStudent(savedStudent).catch(() => {});
      toast.success("Admission saved");
      setForm(initialForm());
      setGeneratedFormNo("");
      void loadNextFormNo();
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Admission failed");
    }
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Form No.</Label>
              <div className="flex gap-2">
                <Input
                  required
                  value={form.form_no}
                  onChange={(e) =>
                    setForm({ ...form, form_no: e.currentTarget.value })
                  }
                />
                {generatedFormNo && form.form_no !== generatedFormNo && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Reset form number"
                    aria-label="Reset form number"
                    onClick={() =>
                      setForm({ ...form, form_no: generatedFormNo })
                    }
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Admission date</Label>
              <Input
                type="date"
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
                  <div className="flex divide-x">
                    {allowedBranches.map((branch) => {
                      const branchCourses = courses.filter(
                        (c) => c.branch_id === branch.id,
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
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Duration</Label>
              <Input value={durationValue} disabled />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>Yearly fee</Label>
              <Input
                type="number"
                min="0"
                value={form.yearly_fee}
                onChange={(e) =>
                  setForm({
                    ...form,
                    yearly_fee: Number(e.currentTarget.value),
                  })
                }
              />
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
                <SelectTrigger>
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

          <div className="flex justify-end">
            <Button>
              <UserPlus className="size-4" />
              Save admission
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

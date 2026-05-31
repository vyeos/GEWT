import { FormEvent, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/app/Field";
import { Info } from "@/components/app/Info";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { today } from "@/lib/format";
import type { Branch, Course, Me, Student } from "@/types";

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
  const [form, setForm] = useState({
    admission_date: today(),
    branch_id: allowedBranches[0]?.id ?? "",
    course_id: "",
    student_name: "",
    category: "General",
    gender: "Male",
    aadhar: "",
    address: "",
    student_phone: "",
    parent_phone: "",
    fee_year_1: 0,
    fee_year_2: 0,
    fee_year_3: 0,
    fee_year_4: 0,
  });
  const branchCourses = courses.filter(
    (course) => course.branch_id === form.branch_id,
  );
  const selectedCourse = branchCourses.find(
    (course) => course.id === form.course_id,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api<Student>("/students", token, {
        method: "POST",
        body: JSON.stringify(form),
      });
      toast.success("Admission saved");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Admission failed");
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-[1fr_340px] gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Admission Form</CardTitle>
          <CardDescription>
            Form number is assigned by the backend from 0001.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <Field label="Admission date">
            <Input
              type="date"
              value={form.admission_date}
              onChange={(e) =>
                setForm({ ...form, admission_date: e.currentTarget.value })
              }
            />
          </Field>
          <Field label="Branch">
            <Select
              value={form.branch_id}
              onValueChange={(branch_id) =>
                setForm({ ...form, branch_id, course_id: "" })
              }
              disabled={me.role !== "admin"}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {allowedBranches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Course">
            <Select
              value={form.course_id}
              onValueChange={(course_id) => setForm({ ...form, course_id })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select course" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {branchCourses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Student name">
            <Input
              required
              value={form.student_name}
              onChange={(e) =>
                setForm({ ...form, student_name: e.currentTarget.value })
              }
            />
          </Field>
          <Field label="Category">
            <Input
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.currentTarget.value })
              }
            />
          </Field>
          <Field label="Gender">
            <Select
              value={form.gender}
              onValueChange={(gender) => setForm({ ...form, gender })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Aadhar">
            <Input
              value={form.aadhar}
              onChange={(e) =>
                setForm({ ...form, aadhar: e.currentTarget.value })
              }
            />
          </Field>
          <Field label="Student phone">
            <Input
              value={form.student_phone}
              onChange={(e) =>
                setForm({ ...form, student_phone: e.currentTarget.value })
              }
            />
          </Field>
          <Field label="Parent phone">
            <Input
              value={form.parent_phone}
              onChange={(e) =>
                setForm({ ...form, parent_phone: e.currentTarget.value })
              }
            />
          </Field>
          <div className="col-span-3">
            <Field label="Address">
              <Textarea
                value={form.address}
                onChange={(e) =>
                  setForm({ ...form, address: e.currentTarget.value })
                }
              />
            </Field>
          </div>
          {[1, 2, 3, 4].map((year) => (
            <Field key={year} label={`Year ${year} fee`}>
              <Input
                type="number"
                min="0"
                value={form[`fee_year_${year}` as keyof typeof form] as number}
                onChange={(e) =>
                  setForm({
                    ...form,
                    [`fee_year_${year}`]: Number(e.currentTarget.value),
                  })
                }
              />
            </Field>
          ))}
          <div className="col-span-3 flex justify-end">
            <Button>
              <UserPlus data-icon="inline-start" />
              Save admission
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Course rule</CardTitle>
          <CardDescription>
            Duration is read from the selected course.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Info
            label="Duration"
            value={
              selectedCourse
                ? `${selectedCourse.duration} ${selectedCourse.duration_type}`
                : "Select course"
            }
          />
          <Info
            label="Branch scope"
            value={
              me.role === "admin"
                ? "All branches"
                : (me.branch_name ?? "Assigned branch")
            }
          />
          <Info label="Academic year" value="Starts in September" />
        </CardContent>
      </Card>
    </form>
  );
}

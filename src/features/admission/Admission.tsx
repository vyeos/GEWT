import { type FormEvent, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
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
    <form onSubmit={submit} className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Admission Form</CardTitle>
          <CardDescription>
            Form number is assigned by the backend from 0001.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
            <div className="flex flex-col gap-2">
              <Label>Branch</Label>
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
            </div>
            <div className="flex flex-col gap-2">
              <Label>Course</Label>
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
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>Student name *</Label>
              <Input
                required
                value={form.student_name}
                onChange={(e) =>
                  setForm({ ...form, student_name: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Category</Label>
              <Input
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Gender</Label>
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
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>Aadhar</Label>
              <Input
                value={form.aadhar}
                onChange={(e) =>
                  setForm({ ...form, aadhar: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Student phone</Label>
              <Input
                value={form.student_phone}
                onChange={(e) =>
                  setForm({ ...form, student_phone: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Parent phone</Label>
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

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[1, 2, 3, 4].map((year) => (
              <div key={year} className="flex flex-col gap-2">
                <Label>Year {year} fee</Label>
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
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button>
              <UserPlus className="size-4" />
              Save admission
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Course info</CardTitle>
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

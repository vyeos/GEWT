import { FormEvent, useState } from "react";
import { BookOpen, Settings } from "lucide-react";
import { toast } from "sonner";
import { DataTable, Row } from "@/components/app/DataTable";
import { Field } from "@/components/app/Field";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { Branch, Course, Me, User } from "@/types";

export function Utility({
  token,
  me,
  branches,
  courses,
  users,
  onSaved,
}: {
  token: string;
  me: Me;
  branches: Branch[];
  courses: Course[];
  users: User[];
  onSaved: () => void;
}) {
  const [course, setCourse] = useState({
    branch_id: branches[0]?.id ?? "",
    name: "",
    duration: 1,
    duration_type: "year",
  });
  const [settings, setSettings] = useState({
    academic_year_start_month: me.academic_year_start_month,
    backups_enabled: true,
  });
  if (me.role !== "admin") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Employee Utility</CardTitle>
          <CardDescription>
            Backup settings are available on the Backup/Import screen. Admin
            utilities are hidden for employee users.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  async function saveCourse(event: FormEvent) {
    event.preventDefault();
    await api("/courses", token, {
      method: "POST",
      body: JSON.stringify(course),
    });
    toast.success("Course saved");
    onSaved();
  }
  async function saveSettings() {
    await api("/academic-settings", token, {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
    toast.success("Academic settings saved");
    onSaved();
  }
  return (
    <Tabs defaultValue="courses">
      <TabsList>
        <TabsTrigger value="courses">Courses</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="courses">
        <div className="grid grid-cols-[420px_1fr] gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Add course</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={saveCourse}>
                <Field label="Branch">
                  <Select
                    value={course.branch_id}
                    onValueChange={(branch_id) =>
                      setCourse({ ...course, branch_id })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {branches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Course name">
                  <Input
                    required
                    value={course.name}
                    onChange={(e) =>
                      setCourse({ ...course, name: e.currentTarget.value })
                    }
                  />
                </Field>
                <Field label="Duration">
                  <Input
                    type="number"
                    min="1"
                    value={course.duration}
                    onChange={(e) =>
                      setCourse({
                        ...course,
                        duration: Number(e.currentTarget.value),
                      })
                    }
                  />
                </Field>
                <Field label="Duration type">
                  <Select
                    value={course.duration_type}
                    onValueChange={(duration_type) =>
                      setCourse({ ...course, duration_type })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="year">Year</SelectItem>
                        <SelectItem value="semester">Semester</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Button>
                  <BookOpen data-icon="inline-start" />
                  Save course
                </Button>
              </form>
            </CardContent>
          </Card>
          <DataTable
            columns="1fr 1fr 120px 120px"
            headers={["Course", "Branch", "Duration", "Type"]}
          >
            {courses.map((item) => (
              <Row key={item.id} columns="1fr 1fr 120px 120px">
                <strong>{item.name}</strong>
                <span>
                  {
                    branches.find((branch) => branch.id === item.branch_id)
                      ?.name
                  }
                </span>
                <span>{item.duration}</span>
                <Badge variant="outline">{item.duration_type}</Badge>
              </Row>
            ))}
          </DataTable>
        </div>
      </TabsContent>
      <TabsContent value="users">
        <DataTable
          columns="1fr 1fr 120px 1fr"
          headers={["User ID", "Name", "Role", "Branch"]}
        >
          {users.map((user) => (
            <Row key={user.id} columns="1fr 1fr 120px 1fr">
              <span>{user.user_id}</span>
              <strong>{user.name}</strong>
              <Badge>{user.role}</Badge>
              <span>
                {branches.find((branch) => branch.id === user.branch_id)
                  ?.name ?? "All branches"}
              </span>
            </Row>
          ))}
        </DataTable>
      </TabsContent>
      <TabsContent value="settings">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Academic and backup settings</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Academic year start month">
              <Input
                type="number"
                min="1"
                max="12"
                value={settings.academic_year_start_month}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    academic_year_start_month: Number(e.currentTarget.value),
                  })
                }
              />
            </Field>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label>Scheduled backups</Label>
                <p className="text-sm text-muted-foreground">
                  Desktop clients can run local backups while open.
                </p>
              </div>
              <Switch
                checked={settings.backups_enabled}
                onCheckedChange={(backups_enabled) =>
                  setSettings({ ...settings, backups_enabled })
                }
              />
            </div>
            <Button onClick={saveSettings} type="button">
              <Settings data-icon="inline-start" />
              Save settings
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

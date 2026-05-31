import { type FormEvent, useEffect, useState } from "react";
import { BookOpen, Settings } from "lucide-react";
import { toast } from "sonner";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { Branch, Course, Me, User } from "@/types";

export function Utility({
  token,
  me,
  branches,
  courses,
  refreshKey,
  onSaved,
}: {
  token: string;
  me: Me;
  branches: Branch[];
  courses: Course[];
  refreshKey: number;
  onSaved: () => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
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

  useEffect(() => {
    async function loadUsers() {
      if (me.role !== "admin") return;

      try {
        setUsers(await api<User[]>("/users", token));
      } catch {
        setUsers([]);
      }
    }

    void loadUsers();
  }, [me.role, token, refreshKey]);

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

      <TabsContent value="courses" className="mt-4">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Add course</CardTitle>
              <CardDescription>Create a new course for a branch</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={saveCourse}>
                <div className="flex flex-col gap-2">
                  <Label>Branch</Label>
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
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Course name</Label>
                  <Input
                    required
                    value={course.name}
                    onChange={(e) =>
                      setCourse({ ...course, name: e.currentTarget.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Duration</Label>
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
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Duration type</Label>
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
                </div>
                <Button>
                  <BookOpen className="size-4" />
                  Save course
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>All courses</CardTitle>
              <CardDescription>
                {courses.length} course{courses.length !== 1 && "s"} configured
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Course</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {courses.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>
                        {branches.find((b) => b.id === item.branch_id)?.name}
                      </TableCell>
                      <TableCell>{item.duration}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.duration_type}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="users" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>
              {users.length} user{users.length !== 1 && "s"} registered
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Branch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.user_id}</TableCell>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {branches.find((b) => b.id === user.branch_id)?.name ??
                        "All branches"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="settings" className="mt-4">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Academic and backup settings</CardTitle>
            <CardDescription>Configure system-wide preferences</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label>Academic year start month</Label>
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
            </div>
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
            <Button onClick={saveSettings} type="button" className="self-start">
              <Settings className="size-4" />
              Save settings
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

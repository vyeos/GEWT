import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  GraduationCap,
  ImageIcon,
  ImageOff,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  UserPlus,
  X,
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { fetchLetterheads, letterheadSrc } from "@/lib/letterhead";
import type { Branch, Course, Me, User } from "@/types";

// Radix Select items can't use an empty string value, so "none" is the sentinel
// for "no letterhead mapped".
const NO_LETTERHEAD = "none";

type CourseForm = {
  branch_id: string;
  name: string;
  duration: number;
  duration_type: Course["duration_type"];
  letterhead: string;
};

type UserForm = {
  user_id: string;
  name: string;
  role: User["role"];
  branch_id: string;
  password: string;
};

function newCourse(branches: Branch[]): CourseForm {
  return {
    branch_id: branches[0]?.id ?? "",
    name: "",
    duration: 1,
    duration_type: "year",
    letterhead: "",
  };
}

function newUser(): UserForm {
  return {
    user_id: "",
    name: "",
    role: "employee",
    branch_id: "",
    password: "",
  };
}

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
  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [course, setCourse] = useState<CourseForm>(() => newCourse(branches));
  const [letterheads, setLetterheads] = useState<string[]>([]);
  const [userForm, setUserForm] = useState<UserForm>(() => newUser());
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | User["role"]>("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [settings, setSettings] = useState({
    academic_year_start_month: me.academic_year_start_month,
  });

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();

    return users.filter((user) => {
      const branchName =
        branches.find((branch) => branch.id === user.branch_id)?.name ??
        "All branches";
      const matchesSearch =
        !term ||
        user.user_id.toLowerCase().includes(term) ||
        user.name.toLowerCase().includes(term) ||
        user.role.toLowerCase().includes(term) ||
        branchName.toLowerCase().includes(term);
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesBranch =
        branchFilter === "all" || user.branch_id === branchFilter;

      return matchesSearch && matchesRole && matchesBranch;
    });
  }, [branchFilter, branches, roleFilter, userSearch, users]);

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

  useEffect(() => {
    void fetchLetterheads().then(setLetterheads);
  }, []);

  if (me.role !== "admin") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Employee Utility</CardTitle>
          <CardDescription>
            Admin utilities are hidden for employee users.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  function openAddCourse() {
    setEditingCourseId(null);
    setCourse(newCourse(branches));
    setCourseDialogOpen(true);
  }

  function resetCourseForm() {
    setEditingCourseId(null);
    setCourse(newCourse(branches));
    setCourseDialogOpen(false);
  }

  function resetUserForm() {
    setEditingUserId(null);
    setUserForm(newUser());
    setUserDialogOpen(false);
  }

  function openAddUser() {
    setEditingUserId(null);
    setUserForm(newUser());
    setUserDialogOpen(true);
  }

  function editCourse(item: Course) {
    setEditingCourseId(item.id);
    setCourse({
      branch_id: item.branch_id,
      name: item.name,
      duration: item.duration,
      duration_type: item.duration_type,
      letterhead: item.letterhead ?? "",
    });
    setCourseDialogOpen(true);
  }

  function editUser(item: User) {
    setEditingUserId(item.id);
    setUserForm({
      user_id: item.user_id,
      name: item.name,
      role: item.role,
      branch_id: item.branch_id ?? "",
      password: "",
    });
    setUserDialogOpen(true);
  }

  async function saveCourse(event: FormEvent) {
    event.preventDefault();
    const path = editingCourseId ? `/courses/${editingCourseId}` : "/courses";
    await api(path, token, {
      method: editingCourseId ? "PATCH" : "POST",
      body: JSON.stringify({
        ...course,
        letterhead: course.letterhead || null,
      }),
    });
    toast.success(editingCourseId ? "Course updated" : "Course saved");
    resetCourseForm();
    setCourseDialogOpen(false);
    onSaved();
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault();
    const path = editingUserId ? `/users/${editingUserId}` : "/users";
    await api<User>(path, token, {
      method: editingUserId ? "PATCH" : "POST",
      body: JSON.stringify({
        user_id: userForm.user_id,
        name: userForm.name,
        role: userForm.role,
        branch_id:
          userForm.role === "employee" && userForm.branch_id
            ? userForm.branch_id
            : null,
        password: userForm.password || null,
      }),
    });
    toast.success(editingUserId ? "User updated" : "User created");
    resetUserForm();
    setUsers(await api<User[]>("/users", token));
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
        <div className="flex flex-col gap-6">
          <Button onClick={openAddCourse} className="w-[25vw] mx-auto">
            <Plus className="size-4" />
            Add course
          </Button>

          {courses.length === 0 ? (
            <Card className="border-dashed pb-0">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
                  <GraduationCap className="size-6 text-muted-foreground" />
                </div>
                <p className="mb-1 font-medium">No courses yet</p>
                <p className="mb-4 text-sm text-muted-foreground">
                  Add your first course to get started
                </p>
                <Button variant="outline" onClick={openAddCourse}>
                  <Plus className="size-4" />
                  Add course
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
              {branches
                .filter((b) => courses.some((c) => c.branch_id === b.id))
                .map((branch) => {
                  const branchCourses = courses.filter(
                    (c) => c.branch_id === branch.id,
                  );
                  return (
                    <Card key={branch.id} className="pb-0">
                      <CardHeader>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-sm">
                            {branch.name}
                          </CardTitle>
                          <Badge variant="secondary" className="text-xs">
                            {branchCourses.length}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="p-0">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Course</TableHead>
                              <TableHead>Duration</TableHead>
                              <TableHead className="w-[50px]" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {branchCourses.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell className="font-medium">
                                  {item.name}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {item.duration} {item.duration_type}
                                  {item.duration !== 1 && "s"}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => editCourse(item)}
                                  >
                                    <Pencil className="size-3.5" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}
        </div>

        <Dialog
          open={courseDialogOpen}
          onOpenChange={(open) => {
            if (!open) resetCourseForm();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingCourseId ? "Edit course" : "New course"}
              </DialogTitle>
              <DialogDescription>
                {editingCourseId
                  ? "Update the course details below"
                  : "Add a new course to a branch"}
              </DialogDescription>
            </DialogHeader>
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
              <div className="grid grid-cols-2 gap-4">
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
                      setCourse({
                        ...course,
                        duration_type: duration_type as Course["duration_type"],
                      })
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
              </div>
              <div className="flex flex-col gap-2">
                <Label>Letterhead</Label>
                <Select
                  value={course.letterhead || NO_LETTERHEAD}
                  onValueChange={(value) =>
                    setCourse({
                      ...course,
                      letterhead: value === NO_LETTERHEAD ? "" : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NO_LETTERHEAD}>None</SelectItem>
                      {letterheads.map((file) => (
                        <SelectItem key={file} value={file}>
                          {file}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-stretch">
                  <div className="flex aspect-[1/1.414] w-full max-w-[10rem] shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted/30 p-3">
                    {course.letterhead ? (
                      <img
                        src={letterheadSrc(course.letterhead)}
                        alt="Letterhead preview"
                        className="max-h-full w-auto max-w-full rounded-md border bg-white object-contain shadow-sm"
                      />
                    ) : letterheads.length === 0 ? (
                      <ImageOff className="size-7 text-muted-foreground/60" />
                    ) : (
                      <ImageIcon className="size-7 text-muted-foreground/60" />
                    )}
                  </div>
                  <div className="flex flex-col justify-center gap-1 text-sm">
                    {course.letterhead ? (
                      <>
                        <p className="font-medium">Letterhead selected</p>
                        <p className="text-muted-foreground">
                          Receipts and admission forms for this course will print
                          on the letterhead shown here.
                        </p>
                      </>
                    ) : letterheads.length === 0 ? (
                      <>
                        <p className="font-medium">No letterheads available</p>
                        <p className="text-muted-foreground">
                          Drop letterhead images into{" "}
                          <code className="rounded bg-muted px-1 py-0.5 text-xs">
                            public/letterheads/
                          </code>
                          , then restart the app.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium">No letterhead selected</p>
                        <p className="text-muted-foreground">
                          Pick a letterhead above to brand this course's printed
                          documents, or leave it as None.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetCourseForm}
                >
                  Cancel
                </Button>
                <Button type="submit">
                  <BookOpen className="size-4" />
                  {editingCourseId ? "Update course" : "Save course"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </TabsContent>

      <TabsContent value="users" className="mt-4">
        <div className="flex flex-col gap-5">
          <Card className="min-w-0 pb-0">
            <CardHeader className="gap-3 border-b">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle>User directory</CardTitle>
                  <CardDescription>
                    Manage admin and employee logins
                  </CardDescription>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row items-center">
                  <div className="relative min-w-0 sm:w-64">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="Search users"
                      value={userSearch}
                      onChange={(event) =>
                        setUserSearch(event.currentTarget.value)
                      }
                    />
                  </div>
                  <Select
                    value={roleFilter}
                    onValueChange={(value) =>
                      setRoleFilter(value as "all" | User["role"])
                    }
                  >
                    <SelectTrigger className="w-full sm:w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">All roles</SelectItem>
                        <SelectItem value="admin">Admins</SelectItem>
                        <SelectItem value="employee">Employees</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Select
                    value={branchFilter}
                    onValueChange={(value) => setBranchFilter(value)}
                  >
                    <SelectTrigger className="w-full sm:w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">All branches</SelectItem>
                        {branches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button onClick={openAddUser} size="sm">
                    <UserPlus className="size-4" />
                    Add User
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredUsers.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
                  <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-muted">
                    <Search className="size-5 text-muted-foreground" />
                  </div>
                  <p className="font-medium">No users match these filters</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Clear search or switch role and branch filters.
                  </p>
                </div>
              ) : (
                <Table className="min-w-[760px] table-fixed">
                  <colgroup>
                    <col className="w-[300px]" />
                    <col className="w-[150px]" />
                    <col className="w-[210px]" />
                    <col className="w-[100px]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Access</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => {
                      const branchName =
                        branches.find((b) => b.id === user.branch_id)?.name ??
                        "All branches";

                      return (
                        <TableRow key={user.id}>
                          <TableCell>
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold">
                                {user.name.slice(0, 1).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate font-medium">
                                  {user.name}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {user.user_id}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                user.role === "admin" ? "default" : "secondary"
                              }
                            >
                              {user.role === "admin" ? "Admin" : "Employee"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="block truncate">{branchName}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => editUser(user)}
                            >
                              <Pencil className="size-4" />
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Dialog
            open={userDialogOpen}
            onOpenChange={(open) => {
              if (!open) resetUserForm();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingUserId ? "Edit user" : "Create user"}
                </DialogTitle>
                <DialogDescription>
                  {editingUserId
                    ? "Update profile, access, or password"
                    : "Add an admin or branch employee"}
                </DialogDescription>
              </DialogHeader>
              <form className="flex flex-col gap-4" onSubmit={saveUser}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label>User ID</Label>
                    <Input
                      required
                      value={userForm.user_id}
                      onChange={(e) =>
                        setUserForm({
                          ...userForm,
                          user_id: e.currentTarget.value,
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Name</Label>
                    <Input
                      required
                      value={userForm.name}
                      onChange={(e) =>
                        setUserForm({
                          ...userForm,
                          name: e.currentTarget.value,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label>Role</Label>
                    <Select
                      value={userForm.role}
                      onValueChange={(role) =>
                        setUserForm({
                          ...userForm,
                          role: role as User["role"],
                          branch_id: role === "admin" ? "" : userForm.branch_id,
                        })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="employee">
                            <span className="flex items-center gap-2">
                              <UserRound className="size-4" />
                              Employee
                            </span>
                          </SelectItem>
                          <SelectItem value="admin">
                            <span className="flex items-center gap-2">
                              <ShieldCheck className="size-4" />
                              Admin
                            </span>
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                  {userForm.role === "employee" && (
                    <div className="flex flex-col gap-2">
                      <Label>Branch</Label>
                      <Select
                        required
                        value={userForm.branch_id}
                        onValueChange={(branch_id) =>
                          setUserForm({ ...userForm, branch_id })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select branch" />
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
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{editingUserId ? "New password" : "Password"}</Label>
                  <Input
                    required={!editingUserId}
                    type="password"
                    value={userForm.password}
                    placeholder={
                      editingUserId ? "Leave blank to keep current" : ""
                    }
                    onChange={(e) =>
                      setUserForm({
                        ...userForm,
                        password: e.currentTarget.value,
                      })
                    }
                  />
                </div>
                <DialogFooter className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetUserForm}
                  >
                    <X className="size-4" />
                    Cancel
                  </Button>
                  <Button>
                    {editingUserId ? (
                      <KeyRound className="size-4" />
                    ) : (
                      <UserPlus className="size-4" />
                    )}
                    {editingUserId ? "Update user" : "Create user"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </TabsContent>

      <TabsContent value="settings" className="mt-4">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Academic settings</CardTitle>
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

import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Database,
  FolderOpen,
  GraduationCap,
  HardDrive,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UserRound,
  UserPlus,
  X,
} from "lucide-react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  api,
  archiveCourse,
  bootStatus,
  deleteCourse,
  listAllCourses,
  setLanDbPath,
  unarchiveCourse,
  updateBranchCode,
  type BootInfo,
} from "@/lib/api";
import { PAGE_ACCESS, pageAccessLabels, type PageAccessField } from "@/lib/access";
import { fetchLetterheads } from "@/lib/letterhead";
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
  active: boolean;
  can_admission: boolean;
  can_receipt: boolean;
  can_outstanding: boolean;
  can_students: boolean;
  can_promote: boolean;
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
    active: true,
    can_admission: true,
    can_receipt: true,
    can_outstanding: true,
    can_students: true,
    can_promote: true,
  };
}

export function Utility({
  token,
  me,
  branches,
  refreshKey,
  onSaved,
}: {
  token: string;
  me: Me;
  branches: Branch[];
  refreshKey: number;
  onSaved: () => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  // The global `courses` prop carries active courses only; the management tab
  // also needs archived ones.
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [deleteCourseTarget, setDeleteCourseTarget] = useState<Course | null>(
    null,
  );
  const [courseActionBusy, setCourseActionBusy] = useState(false);
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
  const [branchCodes, setBranchCodes] = useState<Record<string, string>>(() =>
    Object.fromEntries(branches.map((b) => [b.id, b.code])),
  );
  const [boot, setBoot] = useState<BootInfo | null>(null);
  const [lanBusy, setLanBusy] = useState(false);
  // Semester courses must split evenly into years.
  const courseDurationError =
    course.duration < 1
      ? "Duration must be at least 1"
      : course.duration_type === "semester" && course.duration % 2 !== 0
        ? "Semester courses must have an even number of semesters"
        : null;

  // Keep the editable branch-code inputs in sync when a refresh reloads the
  // branch list (without clobbering codes the admin is currently typing for
  // other branches).
  useEffect(() => {
    setBranchCodes((current) => {
      const next = { ...current };
      for (const branch of branches) {
        if (!(branch.id in next)) next[branch.id] = branch.code;
      }
      return next;
    });
  }, [branches]);

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

  useEffect(() => {
    if (me.role !== "admin") return;
    void bootStatus()
      .then(setBoot)
      .catch(() => setBoot(null));
  }, [me.role]);

  useEffect(() => {
    async function loadAllCourses() {
      if (me.role !== "admin") return;
      try {
        setAllCourses(await listAllCourses());
      } catch {
        setAllCourses([]);
      }
    }

    void loadAllCourses();
  }, [me.role, refreshKey]);

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
      active: item.active,
      can_admission: item.can_admission,
      can_receipt: item.can_receipt,
      can_outstanding: item.can_outstanding,
      can_students: item.can_students,
      can_promote: item.can_promote,
    });
    setUserDialogOpen(true);
  }

  function togglePageAccess(field: PageAccessField, checked: boolean) {
    setUserForm((current) => ({
      ...current,
      [field]: checked,
    }));
  }

  async function saveCourse(event: FormEvent) {
    event.preventDefault();
    if (courseDurationError) {
      toast.error(courseDurationError);
      return;
    }
    try {
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
      await refreshAllCourses();
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save course",
      );
    }
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault();
    try {
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
          active: userForm.active,
          can_admission: userForm.can_admission,
          can_receipt: userForm.can_receipt,
          can_outstanding: userForm.can_outstanding,
          can_students: userForm.can_students,
          can_promote: userForm.can_promote,
        }),
      });
      toast.success(editingUserId ? "User updated" : "User created");
      resetUserForm();
      setUsers(await api<User[]>("/users", token));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save user",
      );
    }
  }

  async function refreshAllCourses() {
    try {
      setAllCourses(await listAllCourses());
    } catch {
      // Keep the stale list; the next global refresh will retry.
    }
  }

  async function toggleCourseArchived(item: Course) {
    setCourseActionBusy(true);
    try {
      if (item.active) {
        await archiveCourse(item.id);
        toast.success(`Archived ${item.name}`);
      } else {
        await unarchiveCourse(item.id);
        toast.success(`Restored ${item.name}`);
      }
      await refreshAllCourses();
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update course",
      );
    } finally {
      setCourseActionBusy(false);
    }
  }

  async function confirmDeleteCourse() {
    const target = deleteCourseTarget;
    if (!target) return;
    setCourseActionBusy(true);
    try {
      await deleteCourse(target.id);
      toast.success(`Deleted ${target.name}`);
      setDeleteCourseTarget(null);
      await refreshAllCourses();
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete course",
      );
    } finally {
      setCourseActionBusy(false);
    }
  }

  async function saveSettings() {
    const month = settings.academic_year_start_month;
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      toast.error("Academic year start month must be between 1 and 12");
      return;
    }
    try {
      await api("/academic-settings", token, {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      toast.success("Academic settings saved");
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save settings",
      );
    }
  }

  async function saveBranchCode(branchId: string) {
    try {
      await updateBranchCode(branchId, branchCodes[branchId] ?? "");
      toast.success("Branch code updated");
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update branch code",
      );
    }
  }

  async function chooseSharedFolder() {
    const picked = await open({
      directory: true,
      title: "Select the shared database folder",
    });
    if (typeof picked !== "string") return;
    const confirmed = await ask(
      `Every machine that should share data must point at this same folder:\n\n${picked}\n\nThe app will restart to apply. Host it on a wired, always-on PC.`,
      { title: "Use shared database", kind: "warning" },
    );
    if (!confirmed) return;
    setLanBusy(true);
    try {
      await setLanDbPath(picked);
      await relaunch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not set shared folder",
      );
      setLanBusy(false);
    }
  }

  async function switchToLocal() {
    const confirmed = await ask(
      "Switch this machine back to its own local database? The app will restart, and it will no longer share data with other machines.",
      { title: "Switch to local database", kind: "warning" },
    );
    if (!confirmed) return;
    setLanBusy(true);
    try {
      await setLanDbPath(null);
      await relaunch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not switch to local",
      );
      setLanBusy(false);
    }
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

          {allCourses.length === 0 ? (
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
                .filter((b) => allCourses.some((c) => c.branch_id === b.id))
                .map((branch) => {
                  const branchCourses = allCourses.filter(
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
                              <TableHead className="w-[110px]" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {branchCourses.map((item) => (
                              <TableRow
                                key={item.id}
                                className={!item.active ? "opacity-60" : undefined}
                              >
                                <TableCell className="font-medium">
                                  <span className="flex items-center gap-1.5">
                                    {item.name}
                                    {!item.active && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        Archived
                                      </Badge>
                                    )}
                                  </span>
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {item.duration} {item.duration_type}
                                  {item.duration !== 1 && "s"}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end gap-0.5">
                                    {item.active && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        title="Edit course"
                                        onClick={() => editCourse(item)}
                                      >
                                        <Pencil className="size-3.5" />
                                      </Button>
                                    )}
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      disabled={courseActionBusy}
                                      title={
                                        item.active
                                          ? "Archive course (hides it from pickers; students keep working)"
                                          : "Restore course"
                                      }
                                      onClick={() =>
                                        void toggleCourseArchived(item)
                                      }
                                    >
                                      {item.active ? (
                                        <Archive className="size-3.5" />
                                      ) : (
                                        <ArchiveRestore className="size-3.5" />
                                      )}
                                    </Button>
                                    {!item.active && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        className="text-destructive hover:text-destructive"
                                        disabled={courseActionBusy}
                                        title="Delete course permanently"
                                        onClick={() =>
                                          setDeleteCourseTarget(item)
                                        }
                                      >
                                        <Trash2 className="size-3.5" />
                                      </Button>
                                    )}
                                  </div>
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
                    step={course.duration_type === "semester" ? 2 : 1}
                    aria-invalid={Boolean(courseDurationError)}
                    value={course.duration}
                    onChange={(e) =>
                      setCourse({
                        ...course,
                        duration: Math.floor(Number(e.currentTarget.value)),
                      })
                    }
                  />
                  {courseDurationError && (
                    <p className="text-xs text-destructive">
                      {courseDurationError}
                    </p>
                  )}
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
              </div>
              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetCourseForm}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={Boolean(courseDurationError)}>
                  <BookOpen className="size-4" />
                  {editingCourseId ? "Update course" : "Save course"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={deleteCourseTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteCourseTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Course</AlertDialogTitle>
              <AlertDialogDescription>
                Permanently delete {deleteCourseTarget?.name}? This is only
                possible while no student was ever admitted to the course, and
                it cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={courseActionBusy}>
                Back
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={courseActionBusy}
                onClick={(event) => {
                  event.preventDefault();
                  void confirmDeleteCourse();
                }}
              >
                {courseActionBusy ? "Deleting..." : "Delete course"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
                    <col className="w-[240px]" />
                    <col className="w-[300px]" />
                    <col className="w-[140px]" />
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
                      const accessLabels = pageAccessLabels(user);

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
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant={
                                    user.role === "admin"
                                      ? "default"
                                      : "secondary"
                                  }
                                >
                                  {user.role === "admin" ? "Admin" : "Employee"}
                                </Badge>
                                {!user.active && (
                                  <Badge variant="destructive">Inactive</Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {accessLabels.map((label) => (
                                  <Badge
                                    key={label}
                                    variant="outline"
                                    className="text-xs"
                                  >
                                    {label}
                                  </Badge>
                                ))}
                              </div>
                            </div>
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
                <div className="flex flex-col gap-3 rounded-md border p-3">
                  <div>
                    <Label>Page access</Label>
                    <p className="text-xs text-muted-foreground">
                      The user will only see checked pages in the sidebar.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {PAGE_ACCESS.map((item) => (
                      <label
                        key={item.field}
                        className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                      >
                        <Checkbox
                          checked={userForm[item.field]}
                          onCheckedChange={(checked) =>
                            togglePageAccess(item.field, checked === true)
                          }
                        />
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </div>
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
                {editingUserId && (
                  <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">Active</p>
                      <p className="text-xs text-muted-foreground">
                        Inactive users cannot sign in.
                      </p>
                    </div>
                    <Switch
                      aria-label="Toggle user active"
                      checked={userForm.active}
                      onCheckedChange={(active) =>
                        setUserForm({ ...userForm, active })
                      }
                    />
                  </div>
                )}
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
        <div className="flex flex-col gap-6">
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle>Academic settings</CardTitle>
              <CardDescription>
                Configure the academic year used for admission form numbering and fee due calculations.
              </CardDescription>
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

          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle>Branch codes</CardTitle>
              <CardDescription>
                The branch segment used in form and receipt numbers.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {branches.map((branch) => (
                <div key={branch.id} className="flex items-end gap-3">
                  <div className="flex flex-1 flex-col gap-2">
                    <Label>{branch.name}</Label>
                    <Input
                      value={branchCodes[branch.id] ?? ""}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        setBranchCodes((current) => ({
                          ...current,
                          [branch.id]: value,
                        }));
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void saveBranchCode(branch.id)}
                  >
                    Save
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle>Shared database (LAN)</CardTitle>
              <CardDescription>
                Point every machine on the network at one shared database so all
                users see the same data in real time. Host the folder on a wired,
                always-on PC; avoid Wi-Fi shares.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-start gap-3 rounded-md border p-3">
                {boot?.lan_active ? (
                  <Database className="mt-0.5 size-5 text-muted-foreground" />
                ) : (
                  <HardDrive className="mt-0.5 size-5 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {boot?.lan_active
                      ? "Shared database"
                      : "Local database (this machine only)"}
                  </p>
                  {boot?.db_path && (
                    <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                      {boot.db_path}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  onClick={() => void chooseSharedFolder()}
                  disabled={lanBusy}
                >
                  <FolderOpen className="size-4" />
                  Use a shared folder
                </Button>
                {boot?.lan_active && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void switchToLocal()}
                    disabled={lanBusy}
                  >
                    <HardDrive className="size-4" />
                    Switch back to local
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Changing this restarts the app. On Windows, disable "offline
                files" caching on the shared folder. Offline use is unavailable
                in shared mode by design.
              </p>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  );
}

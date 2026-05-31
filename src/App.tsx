import { FormEvent, useEffect, useState } from "react";
import {
  Archive,
  BookOpen,
  Building2,
  CalendarClock,
  Download,
  FileDown,
  FileText,
  LogOut,
  ReceiptText,
  Search,
  Settings,
  Shield,
  Upload,
  UserPlus,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import "./App.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

type Role = "admin" | "employee";
type Screen = "admission" | "receipt" | "outstanding" | "utility" | "backup";
type PaymentMode = "Cash" | "UPI" | "DD" | "Cheque" | "NEFT" | "RTGS";

type Branch = { id: string; code: string; name: string };
type Course = { id: string; branch_id: string; name: string; duration: number; duration_type: "year" | "semester" };
type User = { id: string; user_id: string; name: string; role: Role; branch_id: string | null };
type Me = User & { branch_name: string | null; academic_year_start_month: number };
type Student = {
  id: string;
  form_no: string;
  admission_date: string;
  branch_id: string;
  branch_name: string;
  course_id: string;
  course_name: string;
  course_duration: number;
  course_duration_type: "year" | "semester";
  student_name: string;
  category: string;
  gender: string;
  aadhar: string;
  address: string;
  student_phone: string;
  parent_phone: string;
  fee_year_1: number;
  fee_year_2: number;
  fee_year_3: number;
  fee_year_4: number;
};
type OutstandingRow = Student & { total_due: number; total_paid: number; pending: number; current_period: string; last_receipt_no: string | null };

const branchesSeed: Branch[] = [
  { id: "seed-prantij", code: "PRT", name: "Prantij" },
  { id: "seed-hmt", code: "HMT", name: "HMT" },
  { id: "seed-talod", code: "TLD", name: "Talod" },
];

const paymentModes: PaymentMode[] = ["Cash", "UPI", "DD", "Cheque", "NEFT", "RTGS"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function api<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("gewt-token"));
  const [me, setMe] = useState<Me | null>(null);
  const [screen, setScreen] = useState<Screen>("admission");
  const [branches, setBranches] = useState<Branch[]>(branchesSeed);
  const [courses, setCourses] = useState<Course[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [outstanding, setOutstanding] = useState<OutstandingRow[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh(session = token) {
    if (!session) return;
    setLoading(true);
    try {
      const [profile, branchList, courseList, studentList, reportList, userList] = await Promise.all([
        api<Me>("/auth/me", session),
        api<Branch[]>("/branches", session),
        api<Course[]>("/courses", session),
        api<Student[]>("/students", session),
        api<OutstandingRow[]>("/reports/outstanding", session),
        api<User[]>("/users", session).catch(() => []),
      ]);
      setMe(profile);
      setBranches(branchList);
      setCourses(courseList);
      setStudents(studentList);
      setOutstanding(reportList);
      setUsers(userList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load GEWT data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function logout() {
    localStorage.removeItem("gewt-token");
    setToken(null);
    setMe(null);
  }

  if (!token || !me) {
    return <Login onLogin={(nextToken) => {
      localStorage.setItem("gewt-token", nextToken);
      setToken(nextToken);
      void refresh(nextToken);
    }} />;
  }

  const nav: { key: Screen; label: string; icon: React.ElementType }[] = [
    { key: "admission", label: "Admission", icon: UserPlus },
    { key: "receipt", label: "Fee Receipt", icon: ReceiptText },
    { key: "outstanding", label: "Outstanding", icon: FileText },
    { key: "utility", label: "Utility", icon: Settings },
    { key: "backup", label: "Backup/Import", icon: Archive },
  ];

  return (
    <div className="min-h-screen">
      <Toaster richColors />
      <aside className="fixed inset-y-0 left-0 flex w-72 flex-col border-r bg-card">
        <div className="flex h-20 items-center gap-3 border-b px-5">
          <div className="flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BookOpen />
          </div>
          <div>
            <div className="text-xl font-semibold">GEWT Fees</div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Academic ledger</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Button key={item.key} variant={screen === item.key ? "secondary" : "ghost"} className="justify-start" onClick={() => setScreen(item.key)}>
                <Icon data-icon="inline-start" />
                {item.label}
              </Button>
            );
          })}
        </nav>
        <div className="border-t p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{me.name}</div>
              <div className="text-sm text-muted-foreground">{me.branch_name ?? "All branches"}</div>
            </div>
            <Badge variant={me.role === "admin" ? "default" : "secondary"}>{me.role}</Badge>
          </div>
          <Button variant="outline" className="w-full justify-start" onClick={logout}>
            <LogOut data-icon="inline-start" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="ml-72 min-h-screen p-6">
        <header className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              {nav.find((item) => item.key === screen)?.label}
            </h1>
            <p className="text-sm text-muted-foreground">
              September academic year start. API enforces role and branch scope.
            </p>
          </div>
          <Button variant="outline" onClick={() => void refresh()}>
            <Search data-icon="inline-start" />
            {loading ? "Refreshing" : "Refresh"}
          </Button>
        </header>

        {screen === "admission" && <Admission token={token} me={me} branches={branches} courses={courses} onSaved={() => void refresh()} />}
        {screen === "receipt" && <Receipt token={token} students={students} onSaved={() => void refresh()} />}
        {screen === "outstanding" && <Outstanding rows={outstanding} branches={branches} me={me} />}
        {screen === "utility" && <Utility token={token} me={me} branches={branches} courses={courses} users={users} onSaved={() => void refresh()} />}
        {screen === "backup" && <Backup token={token} me={me} />}
      </main>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [userId, setUserId] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ token: string }>("/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ user_id: userId, password }),
      });
      onLogin(result.token);
      toast.success("Signed in");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen grid-cols-[1.05fr_0.95fr]">
      <Toaster richColors />
      <section className="flex flex-col justify-between bg-primary p-10 text-primary-foreground">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-md bg-white/15">
            <Shield />
          </div>
          <div>
            <div className="text-2xl font-semibold">GEWT Fee Management</div>
            <div className="text-sm opacity-80">Cloud-secured branch ledger</div>
          </div>
        </div>
        <div className="max-w-xl">
          <h1 className="text-5xl font-semibold leading-tight tracking-normal">Admissions, receipts, and dues without branch leakage.</h1>
          <p className="mt-5 text-lg opacity-85">Admin works across Prantij, HMT, and Talod. Employees stay inside their assigned branch from login through every API call.</p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          {["Auto numbering", "September year", "Backup import"].map((item) => (
            <div key={item} className="rounded-md border border-white/20 p-3">{item}</div>
          ))}
        </div>
      </section>
      <section className="flex items-center justify-center p-10">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use seeded admin: admin / admin123 after running migrations.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <Field label="User ID">
                <Input value={userId} onChange={(event) => setUserId(event.currentTarget.value)} />
              </Field>
              <Field label="Password">
                <Input type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
              </Field>
              <Button disabled={busy}>{busy ? "Signing in" : "Login"}</Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function Admission({ token, me, branches, courses, onSaved }: { token: string; me: Me; branches: Branch[]; courses: Course[]; onSaved: () => void }) {
  const allowedBranches = me.role === "admin" ? branches : branches.filter((branch) => branch.id === me.branch_id);
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
  const branchCourses = courses.filter((course) => course.branch_id === form.branch_id);
  const selectedCourse = branchCourses.find((course) => course.id === form.course_id);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api<Student>("/students", token, { method: "POST", body: JSON.stringify(form) });
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
          <CardDescription>Form number is assigned by the backend from 0001.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <Field label="Admission date"><Input type="date" value={form.admission_date} onChange={(e) => setForm({ ...form, admission_date: e.currentTarget.value })} /></Field>
          <Field label="Branch">
            <Select value={form.branch_id} onValueChange={(branch_id) => setForm({ ...form, branch_id, course_id: "" })} disabled={me.role !== "admin"}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{allowedBranches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field label="Course">
            <Select value={form.course_id} onValueChange={(course_id) => setForm({ ...form, course_id })}>
              <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
              <SelectContent><SelectGroup>{branchCourses.map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field label="Student name"><Input required value={form.student_name} onChange={(e) => setForm({ ...form, student_name: e.currentTarget.value })} /></Field>
          <Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.currentTarget.value })} /></Field>
          <Field label="Gender">
            <Select value={form.gender} onValueChange={(gender) => setForm({ ...form, gender })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem></SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field label="Aadhar"><Input value={form.aadhar} onChange={(e) => setForm({ ...form, aadhar: e.currentTarget.value })} /></Field>
          <Field label="Student phone"><Input value={form.student_phone} onChange={(e) => setForm({ ...form, student_phone: e.currentTarget.value })} /></Field>
          <Field label="Parent phone"><Input value={form.parent_phone} onChange={(e) => setForm({ ...form, parent_phone: e.currentTarget.value })} /></Field>
          <div className="col-span-3"><Field label="Address"><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.currentTarget.value })} /></Field></div>
          {[1, 2, 3, 4].map((year) => (
            <Field key={year} label={`Year ${year} fee`}>
              <Input type="number" min="0" value={form[`fee_year_${year}` as keyof typeof form] as number} onChange={(e) => setForm({ ...form, [`fee_year_${year}`]: Number(e.currentTarget.value) })} />
            </Field>
          ))}
          <div className="col-span-3 flex justify-end"><Button><UserPlus data-icon="inline-start" />Save admission</Button></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Course rule</CardTitle>
          <CardDescription>Duration is read from the selected course.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Info label="Duration" value={selectedCourse ? `${selectedCourse.duration} ${selectedCourse.duration_type}` : "Select course"} />
          <Info label="Branch scope" value={me.role === "admin" ? "All branches" : me.branch_name ?? "Assigned branch"} />
          <Info label="Academic year" value="Starts in September" />
        </CardContent>
      </Card>
    </form>
  );
}

function Receipt({ token, students, onSaved }: { token: string; students: Student[]; onSaved: () => void }) {
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [amount, setAmount] = useState(0);
  const [reference, setReference] = useState("");
  const requiresRef = mode !== "Cash";

  useEffect(() => {
    if (!studentId && students[0]) setStudentId(students[0].id);
  }, [students, studentId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (requiresRef && !reference) {
      toast.error("Reference is required for non-cash payments");
      return;
    }
    try {
      await api("/receipts", token, {
        method: "POST",
        body: JSON.stringify({ student_id: studentId, receipt_date: today(), amount_paid: amount, payment_mode: mode, reference_no: reference }),
      });
      toast.success("Receipt saved");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Receipt failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fee Receipt</CardTitle>
        <CardDescription>Receipt number starts at 1 and increments inside a database transaction.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-4 gap-4">
          <Field label="Student">
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
              <SelectContent><SelectGroup>{students.map((student) => <SelectItem key={student.id} value={student.id}>{student.form_no} - {student.student_name}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field label="Amount paid"><Input required type="number" min="1" value={amount} onChange={(e) => setAmount(Number(e.currentTarget.value))} /></Field>
          <Field label="Payment mode">
            <Select value={mode} onValueChange={(value) => setMode(value as PaymentMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{paymentModes.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field label={requiresRef ? "Reference number" : "Reference"}>
            <Input value={reference} disabled={!requiresRef} required={requiresRef} onChange={(e) => setReference(e.currentTarget.value)} />
          </Field>
          <div className="col-span-4 flex justify-end"><Button><ReceiptText data-icon="inline-start" />Save receipt</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function Outstanding({ rows, branches, me }: { rows: OutstandingRow[]; branches: Branch[]; me: Me }) {
  const [branchId, setBranchId] = useState("all");
  const visible = rows.filter((row) => branchId === "all" || row.branch_id === branchId);
  const total = visible.reduce((sum, row) => sum + row.pending, 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-4">
        <Card><CardHeader><CardTitle>{visible.length}</CardTitle><CardDescription>Students with pending fees</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>{money(total)}</CardTitle><CardDescription>Total pending</CardDescription></CardHeader></Card>
        <Card>
          <CardHeader>
            <CardTitle>Branch filter</CardTitle>
            <Select value={branchId} onValueChange={setBranchId} disabled={me.role !== "admin"}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="all">All branches</SelectItem>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </CardHeader>
        </Card>
      </div>
      <DataTable columns="90px 1.3fr 1fr 1fr 1fr 1fr 1fr 110px" headers={["Form", "Student", "Branch", "Course", "Period", "Due", "Paid", "Pending"]}>
        {visible.map((row) => (
          <Row key={row.id} columns="90px 1.3fr 1fr 1fr 1fr 1fr 1fr 110px">
            <span>{row.form_no}</span><strong>{row.student_name}</strong><span>{row.branch_name}</span><span>{row.course_name}</span><span>{row.current_period}</span><span>{money(row.total_due)}</span><span>{money(row.total_paid)}</span><Badge variant="destructive">{money(row.pending)}</Badge>
          </Row>
        ))}
      </DataTable>
    </div>
  );
}

function Utility({ token, me, branches, courses, users, onSaved }: { token: string; me: Me; branches: Branch[]; courses: Course[]; users: User[]; onSaved: () => void }) {
  const [course, setCourse] = useState({ branch_id: branches[0]?.id ?? "", name: "", duration: 1, duration_type: "year" });
  const [settings, setSettings] = useState({ academic_year_start_month: me.academic_year_start_month, backups_enabled: true });
  if (me.role !== "admin") {
    return (
      <Card>
        <CardHeader><CardTitle>Employee Utility</CardTitle><CardDescription>Backup settings are available on the Backup/Import screen. Admin utilities are hidden for employee users.</CardDescription></CardHeader>
      </Card>
    );
  }
  async function saveCourse(event: FormEvent) {
    event.preventDefault();
    await api("/courses", token, { method: "POST", body: JSON.stringify(course) });
    toast.success("Course saved");
    onSaved();
  }
  async function saveSettings() {
    await api("/academic-settings", token, { method: "PATCH", body: JSON.stringify(settings) });
    toast.success("Academic settings saved");
    onSaved();
  }
  return (
    <Tabs defaultValue="courses">
      <TabsList><TabsTrigger value="courses">Courses</TabsTrigger><TabsTrigger value="users">Users</TabsTrigger><TabsTrigger value="settings">Settings</TabsTrigger></TabsList>
      <TabsContent value="courses">
        <div className="grid grid-cols-[420px_1fr] gap-5">
          <Card><CardHeader><CardTitle>Add course</CardTitle></CardHeader><CardContent>
            <form className="flex flex-col gap-4" onSubmit={saveCourse}>
              <Field label="Branch"><Select value={course.branch_id} onValueChange={(branch_id) => setCourse({ ...course, branch_id })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
              <Field label="Course name"><Input required value={course.name} onChange={(e) => setCourse({ ...course, name: e.currentTarget.value })} /></Field>
              <Field label="Duration"><Input type="number" min="1" value={course.duration} onChange={(e) => setCourse({ ...course, duration: Number(e.currentTarget.value) })} /></Field>
              <Field label="Duration type"><Select value={course.duration_type} onValueChange={(duration_type) => setCourse({ ...course, duration_type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="year">Year</SelectItem><SelectItem value="semester">Semester</SelectItem></SelectGroup></SelectContent></Select></Field>
              <Button><BookOpen data-icon="inline-start" />Save course</Button>
            </form>
          </CardContent></Card>
          <DataTable columns="1fr 1fr 120px 120px" headers={["Course", "Branch", "Duration", "Type"]}>
            {courses.map((item) => <Row key={item.id} columns="1fr 1fr 120px 120px"><strong>{item.name}</strong><span>{branches.find((branch) => branch.id === item.branch_id)?.name}</span><span>{item.duration}</span><Badge variant="outline">{item.duration_type}</Badge></Row>)}
          </DataTable>
        </div>
      </TabsContent>
      <TabsContent value="users"><DataTable columns="1fr 1fr 120px 1fr" headers={["User ID", "Name", "Role", "Branch"]}>{users.map((user) => <Row key={user.id} columns="1fr 1fr 120px 1fr"><span>{user.user_id}</span><strong>{user.name}</strong><Badge>{user.role}</Badge><span>{branches.find((branch) => branch.id === user.branch_id)?.name ?? "All branches"}</span></Row>)}</DataTable></TabsContent>
      <TabsContent value="settings">
        <Card className="max-w-xl"><CardHeader><CardTitle>Academic and backup settings</CardTitle></CardHeader><CardContent className="flex flex-col gap-4">
          <Field label="Academic year start month"><Input type="number" min="1" max="12" value={settings.academic_year_start_month} onChange={(e) => setSettings({ ...settings, academic_year_start_month: Number(e.currentTarget.value) })} /></Field>
          <div className="flex items-center justify-between rounded-md border p-3"><div><Label>Scheduled backups</Label><p className="text-sm text-muted-foreground">Desktop clients can run local backups while open.</p></div><Switch checked={settings.backups_enabled} onCheckedChange={(backups_enabled) => setSettings({ ...settings, backups_enabled })} /></div>
          <Button onClick={saveSettings} type="button"><Settings data-icon="inline-start" />Save settings</Button>
        </CardContent></Card>
      </TabsContent>
    </Tabs>
  );
}

function Backup({ token, me }: { token: string; me: Me }) {
  const [frequency, setFrequency] = useState("monthly");
  const [customDays, setCustomDays] = useState(30);
  async function exportBackup() {
    const response = await fetch(`${API_BASE}/backups/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ format: "postgres_dump" }),
    });
    if (!response.ok) throw new Error(await response.text());
    const blob = await response.blob();
    const fileName = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `gewt-${Date.now()}.dump`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(`Backup downloaded: ${fileName}`);
  }
  async function importBackup() {
    if (me.role !== "admin") return toast.error("Only admins can import backups");
    await api("/backups/validate-import", token, { method: "POST", body: JSON.stringify({ file_name: "selected-backup.dump" }) });
    toast.info("Backup validated. Import merge selection would open next.");
  }
  return (
    <div className="grid grid-cols-2 gap-5">
      <Card><CardHeader><CardTitle>Manual backup</CardTitle><CardDescription>Available to admin and employee users.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><Button onClick={exportBackup}><Download data-icon="inline-start" />Create backup</Button><Separator /><Field label="Local backup location"><Input placeholder="/Users/shared/GEWT Backups" /></Field></CardContent></Card>
      <Card><CardHeader><CardTitle>Scheduled backup</CardTitle><CardDescription>Runs from each desktop app while it is open.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><Field label="Frequency"><Select value={frequency} onValueChange={setFrequency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="custom">Custom days</SelectItem></SelectGroup></SelectContent></Select></Field>{frequency === "custom" && <Field label="Custom days"><Input type="number" min="1" value={customDays} onChange={(e) => setCustomDays(Number(e.currentTarget.value))} /></Field>}<Button variant="outline"><CalendarClock data-icon="inline-start" />Save schedule</Button></CardContent></Card>
      <Card className="col-span-2"><CardHeader><CardTitle>Import recovery</CardTitle><CardDescription>Admin-only merge import with conflict policy and audit log.</CardDescription></CardHeader><CardContent className="flex gap-3"><Button variant="outline" onClick={importBackup} disabled={me.role !== "admin"}><Upload data-icon="inline-start" />Validate import</Button><Button disabled={me.role !== "admin"}><FileDown data-icon="inline-start" />Import: backup wins</Button><Button disabled={me.role !== "admin"} variant="secondary"><Building2 data-icon="inline-start" />Import: cloud wins</Button></CardContent></Card>
    </div>
  );
}

function DataTable({ columns, headers, children }: { columns: string; headers: string[]; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-auto">
        <div className="table-grid border-b bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground" style={{ gridTemplateColumns: columns }}>{headers.map((header) => <span key={header}>{header}</span>)}</div>
        <div className="divide-y">{children}</div>
      </div>
    </Card>
  );
}

function Row({ columns, children }: { columns: string; children: React.ReactNode }) {
  return <div className="table-grid px-4 py-3 text-sm" style={{ gridTemplateColumns: columns }}>{children}</div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 font-medium">{value}</div></div>;
}

export default App;

import {
  useEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from "react";
import {
  DatabaseBackup,
  Download,
  FileText,
  GraduationCap,
  LogOut,
  Moon,
  ReceiptText,
  RefreshCw,
  Settings,
  Sun,
  Users,
  UserPlus,
} from "lucide-react";
import { Toaster } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import {
  checkForUpdate,
  downloadUpdate,
  installAndRelaunch,
} from "@/lib/updater";
import { cn } from "@/lib/utils";
import type { Me, Screen } from "@/types";
import type { UpdateStatus } from "@/lib/updater";

const nav: {
  key: Screen;
  label: string;
  desc: string;
  icon: ElementType;
  adminOnly?: boolean;
}[] = [
  {
    key: "admission",
    label: "Admission",
    desc: "Register new students",
    icon: UserPlus,
  },
  {
    key: "receipt",
    label: "Fee Receipt",
    desc: "Record fee payments",
    icon: ReceiptText,
  },
  {
    key: "promote",
    label: "Promote",
    desc: "Move students to next semester/term",
    icon: GraduationCap,
  },
  {
    key: "outstanding",
    label: "Outstanding",
    desc: "Pending fee report",
    icon: FileText,
  },
  {
    key: "students",
    label: "Students",
    desc: "Review and edit admissions",
    icon: Users,
    adminOnly: true,
  },
  {
    key: "backup",
    label: "Backup",
    desc: "Export, import & local snapshots",
    icon: DatabaseBackup,
  },
  {
    key: "utility",
    label: "Utility",
    desc: "Courses, users & settings",
    icon: Settings,
    adminOnly: true,
  },
];

export function AppShell({
  me,
  screen,
  loading,
  isDarkMode,
  children,
  onScreenChange,
  onThemeChange,
  onRefresh,
  onLogout,
}: {
  me: Me;
  screen: Screen;
  loading: boolean;
  isDarkMode: boolean;
  children: ReactNode;
  onScreenChange: (screen: Screen) => void;
  onThemeChange: (isDarkMode: boolean) => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: "idle",
  });
  const updateRef =
    useRef<Awaited<ReturnType<typeof checkForUpdate>>["update"]>(undefined);
  const current = nav.find((item) => item.key === screen);

  useEffect(() => {
    async function downloadPendingUpdate() {
      setUpdateStatus({ state: "checking" });

      try {
        const result = await checkForUpdate();

        if (!result.available || !result.update) {
          setUpdateStatus({ state: "up-to-date" });
          return;
        }

        updateRef.current = result.update;
        setUpdateStatus({ state: "downloading", progress: 0 });
        await downloadUpdate(result.update, (progress) => {
          setUpdateStatus({ state: "downloading", progress });
        });
        setUpdateStatus({ state: "ready" });
      } catch (error) {
        setUpdateStatus({
          state: "error",
          message:
            error instanceof Error ? error.message : "Unable to check updates",
        });
      }
    }

    void downloadPendingUpdate();
  }, []);

  async function restartToUpdate() {
    if (!updateRef.current) return;

    try {
      await installAndRelaunch(updateRef.current);
    } catch (error) {
      setUpdateStatus({
        state: "error",
        message:
          error instanceof Error ? error.message : "Unable to install update",
      });
    }
  }

  return (
    <div className="flex h-screen">
      <Toaster richColors />
      <aside className="flex w-56 flex-col border-r bg-sidebar">
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <img
            src="/logo.png"
            alt="GEWT logo"
            className="size-9 shrink-0 rounded-md object-contain"
          />
          <h1 className="text-lg font-semibold">GEWT</h1>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-2">
          {nav
            .filter((item) => !item.adminOnly || me.role === "admin")
            .map((item) => {
              const Icon = item.icon;
              const active = screen === item.key;
              return (
                <Button
                  key={item.key}
                  onClick={() => onScreenChange(item.key)}
                  variant={active ? "outline" : "ghost"}
                  className={cn("justify-start gap-3 transition-colors")}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Button>
              );
            })}
        </nav>

        <div className="border-t p-3">
          {updateStatus.state === "ready" && (
            <Button
              className="mb-3 w-full gap-3"
              size="sm"
              onClick={() => void restartToUpdate()}
            >
              <Download className="size-4" />
              Restart to update
            </Button>
          )}
          {updateStatus.state === "downloading" && (
            <div className="mb-3 flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <RefreshCw className="size-3 animate-spin" />
              <span>Updating... {updateStatus.progress}%</span>
            </div>
          )}
          {updateStatus.state === "error" && (
            <div className="mb-3 px-1 text-xs text-destructive">
              Update check failed
            </div>
          )}
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
              {isDarkMode ? (
                <Moon className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Sun className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span>Dark mode</span>
            </div>
            <Switch
              aria-label="Toggle dark mode"
              checked={isDarkMode}
              onCheckedChange={onThemeChange}
            />
          </div>
        </div>

        <div className="border-t p-3">
          <div className="mb-3 flex items-center gap-3 px-1">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium capitalize">
                {me.name}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {me.branch_name ?? "All branches"}
              </div>
            </div>
            <Badge className="shrink-0 capitalize">{me.role}</Badge>
          </div>
          <Button
            variant="destructive"
            className="w-full gap-3"
            size="sm"
            onClick={() => setLogoutOpen(true)}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="flex flex-col gap-6 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold">{current?.label}</h2>
              <p className="text-sm text-muted-foreground">{current?.desc}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
              {loading ? "Refreshing" : "Refresh"}
            </Button>
          </div>
          {children}
        </div>
      </main>

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Sign Out</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to sign out? You will need to sign in again
              to access GEWT.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLogoutOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onLogout}>Sign Out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

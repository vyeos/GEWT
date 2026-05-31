import { useState, type ElementType, type ReactNode } from "react";
import {
  Archive,
  BookOpen,
  FileText,
  LogOut,
  ReceiptText,
  RefreshCw,
  Settings,
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
import { cn } from "@/lib/utils";
import type { Me, Screen } from "@/types";

const nav: { key: Screen; label: string; desc: string; icon: ElementType }[] = [
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
    key: "outstanding",
    label: "Outstanding",
    desc: "Pending fee report",
    icon: FileText,
  },
  {
    key: "utility",
    label: "Utility",
    desc: "Courses, users & settings",
    icon: Settings,
  },
  {
    key: "backup",
    label: "Backup/Import",
    desc: "Data backup & recovery",
    icon: Archive,
  },
];

export function AppShell({
  me,
  screen,
  loading,
  children,
  onScreenChange,
  onRefresh,
  onLogout,
}: {
  me: Me;
  screen: Screen;
  loading: boolean;
  children: ReactNode;
  onScreenChange: (screen: Screen) => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const [logoutOpen, setLogoutOpen] = useState(false);
  const current = nav.find((item) => item.key === screen);

  return (
    <div className="flex h-screen">
      <Toaster richColors />
      <aside className="flex w-56 flex-col border-r bg-sidebar">
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BookOpen className="size-4" />
          </div>
          <h1 className="text-lg font-semibold">GEWT Fees</h1>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-2">
          {nav.map((item) => {
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

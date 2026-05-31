import type { ElementType, ReactNode } from "react";
import {
  Archive,
  BookOpen,
  FileText,
  LogOut,
  ReceiptText,
  Search,
  Settings,
  UserPlus,
} from "lucide-react";
import { Toaster } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Me, Screen } from "@/types";

const nav: { key: Screen; label: string; icon: ElementType }[] = [
  { key: "admission", label: "Admission", icon: UserPlus },
  { key: "receipt", label: "Fee Receipt", icon: ReceiptText },
  { key: "outstanding", label: "Outstanding", icon: FileText },
  { key: "utility", label: "Utility", icon: Settings },
  { key: "backup", label: "Backup/Import", icon: Archive },
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
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Academic ledger
            </div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.key}
                variant={screen === item.key ? "secondary" : "ghost"}
                className="justify-start"
                onClick={() => onScreenChange(item.key)}
              >
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
              <div className="text-sm text-muted-foreground">
                {me.branch_name ?? "All branches"}
              </div>
            </div>
            <Badge variant={me.role === "admin" ? "default" : "secondary"}>
              {me.role}
            </Badge>
          </div>
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={onLogout}
          >
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
          <Button variant="outline" onClick={onRefresh}>
            <Search data-icon="inline-start" />
            {loading ? "Refreshing" : "Refresh"}
          </Button>
        </header>

        {children}
      </main>
    </div>
  );
}

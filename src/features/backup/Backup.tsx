import { useState } from "react";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import {
  DatabaseBackup,
  Download,
  HardDriveDownload,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createSnapshot, exportBackup, importBackup } from "@/lib/api";
import { today } from "@/lib/format";
import type { Branch, Me } from "@/types";

export function Backup({ me, branches }: { me: Me; branches: Branch[] }) {
  const isAdmin = me.role === "admin";
  const ownBranch = branches.find((b) => b.id === me.branch_id);
  const [selected, setSelected] = useState<string[]>(branches.map((b) => b.id));
  const [busy, setBusy] = useState(false);

  function toggleBranch(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((b) => b !== id)
        : [...current, id],
    );
  }

  async function handleExport() {
    const branchIds = isAdmin ? selected : [];
    if (isAdmin && branchIds.length === 0) {
      toast.error("Select at least one branch to back up");
      return;
    }
    const label = isAdmin
      ? branchIds.length === branches.length
        ? "all"
        : `${branchIds.length}-branch`
      : (ownBranch?.code ?? "branch");
    const dest = await save({
      defaultPath: `gewt-backup-${label}-${today()}.gewtbak`,
      filters: [{ name: "GEWT Backup", extensions: ["gewtbak"] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      await exportBackup(branchIds, dest);
      toast.success("Backup saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Backup failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    const src = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "GEWT Backup", extensions: ["gewtbak", "json"] }],
    });
    if (!src || typeof src !== "string") return;
    const confirmed = await ask(
      "Importing replaces the data for every branch contained in this file. Other branches on this machine are left untouched. You will be signed out afterwards. Continue?",
      { title: "Import backup", kind: "warning" },
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const summary = await importBackup(src);
      toast.success(
        `Imported ${summary.students} students, ${summary.receipts} receipts across ${summary.branches.length} branch(es)`,
      );
      // The session was cleared on the backend (accounts may have changed);
      // reload so the app returns to the login screen.
      setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSnapshot() {
    setBusy(true);
    try {
      await createSnapshot();
      toast.success("Local snapshot created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Snapshot failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="size-5" />
            Export backup
          </CardTitle>
          <CardDescription>
            {isAdmin
              ? "Save a backup file to share with another machine, or to keep as a transfer copy. Choose which branches to include."
              : `Save a backup of the ${ownBranch?.name ?? "your"} branch to share with the admin or another machine.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isAdmin && (
            <div className="flex flex-col gap-2">
              {branches.map((branch) => (
                <label
                  key={branch.id}
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={selected.includes(branch.id)}
                    onChange={() => toggleBranch(branch.id)}
                  />
                  {branch.name}
                  <span className="text-muted-foreground">({branch.code})</span>
                </label>
              ))}
            </div>
          )}
          <Button onClick={() => void handleExport()} disabled={busy} className="self-start">
            <Download className="size-4" />
            Backup now
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="size-5" />
            Import backup
          </CardTitle>
          <CardDescription>
            Load a <code className="rounded bg-muted px-1 py-0.5 text-xs">.gewtbak</code>{" "}
            file. The data for each branch in the file replaces that branch's data
            on this machine; other branches are left untouched.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => void handleImport()}
            disabled={busy}
          >
            <Upload className="size-4" />
            Import backup
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup className="size-5" />
            Local safety snapshots
          </CardTitle>
          <CardDescription>
            A timestamped copy of the database is saved automatically when you
            close the app (and once a day on launch). The last 10 are kept on
            this machine and never leave it. You can also take one now.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => void handleSnapshot()}
            disabled={busy}
          >
            <HardDriveDownload className="size-4" />
            Create snapshot now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

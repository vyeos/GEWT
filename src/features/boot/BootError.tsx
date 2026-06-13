import { useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { AlertTriangle, FolderX, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setLanDbPath, type BootInfo } from "@/lib/api";

/// Shown when the app could not open its database — typically a configured LAN
/// folder that is offline. We never fall back to the local DB silently, so the
/// admin must either reconnect the drive (Retry) or deliberately switch back to
/// this machine's local database.
export function BootError({ boot }: { boot: BootInfo }) {
  const [busy, setBusy] = useState(false);

  async function switchToLocal() {
    setBusy(true);
    try {
      await setLanDbPath(null);
      await relaunch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not switch to local",
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="size-6 text-destructive" />
        </div>
        <div>
          <p className="text-base font-semibold text-foreground">
            Shared database not reachable
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {boot.error ??
              "The shared database could not be opened on this machine."}
          </p>
          {boot.db_path && (
            <p className="mt-2 break-all rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              {boot.db_path}
            </p>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Reconnect the network drive and retry, or switch this machine back to
          its own local database.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => void relaunch()} disabled={busy}>
            <RefreshCw className="size-4" />
            Retry
          </Button>
          <Button variant="outline" onClick={() => void switchToLocal()} disabled={busy}>
            <FolderX className="size-4" />
            Switch to local database
          </Button>
        </div>
      </div>
    </div>
  );
}

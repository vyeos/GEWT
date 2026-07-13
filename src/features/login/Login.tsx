import { useEffect, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { HardDriveDownload } from "lucide-react";
import { toast, Toaster } from "sonner";
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
import { bootstrapFromBackup, isDevicePristine, login } from "@/lib/api";
import type { Me } from "@/types";

export function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Only offered on a brand-new device (backend confirms it is pristine).
  const [pristine, setPristine] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isDevicePristine()
      .then((value) => {
        if (!cancelled) setPristine(value);
      })
      .catch(() => {
        // Not fatal — just hide the first-run affordance and let people log in.
        if (!cancelled) setPristine(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const me = await login(userId, password);
      onLogin(me);
      toast.success("Signed in");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleBootstrap() {
    const src = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "GEWT Backup", extensions: ["gewtbak", "json"] }],
    });
    if (!src || typeof src !== "string") return;
    setBootstrapping(true);
    try {
      const summary = await bootstrapFromBackup(src);
      toast.success(
        `Device set up: ${summary.students} students across ${summary.branches.length} branch(es). Sign in with your account.`,
      );
      // The device is now provisioned, so hide the first-run affordance and let
      // the employee sign in as themselves on this same login screen.
      setPristine(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Setup failed");
    } finally {
      setBootstrapping(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Toaster richColors />
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <img
            src="/logo.png"
            alt="GEWT logo"
            className="mx-auto mb-3 size-20 object-contain"
          />
          <CardTitle className="text-2xl">GEWT Fees</CardTitle>
          <CardDescription>
            Sign in to access the academic ledger
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="userId">User ID</Label>
              <Input
                id="userId"
                value={userId}
                onChange={(e) => setUserId(e.currentTarget.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in..." : "Sign In"}
            </Button>
          </form>
          {pristine && (
            <div className="mt-6 border-t pt-4">
              <p className="mb-3 text-sm text-muted-foreground">
                New device? Load a backup from the admin to set up your account,
                then sign in above.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void handleBootstrap()}
                disabled={bootstrapping}
              >
                <HardDriveDownload className="size-4" />
                {bootstrapping
                  ? "Setting up device..."
                  : "Set up this device from backup"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

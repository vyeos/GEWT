import { useEffect, useState, type FormEvent } from "react";
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
import { api } from "@/lib/api";
import {
  getEnvConfigStatus,
  saveEnvConfig,
  type EnvConfigStatus,
} from "@/lib/env-config";

export function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [userId, setUserId] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [busy, setBusy] = useState(false);
  const [configStatus, setConfigStatus] = useState<EnvConfigStatus | null>(
    null,
  );
  const [checkingConfig, setCheckingConfig] = useState(true);
  const [databaseUrl, setDatabaseUrl] = useState(
    "postgres://postgres:postgres@localhost:5432/gewt",
  );
  const [jwtSecret, setJwtSecret] = useState("");
  const [apiAddr, setApiAddr] = useState("127.0.0.1:45123");
  const [savingConfig, setSavingConfig] = useState(false);

  const needsConfig = configStatus?.configured === false;

  useEffect(() => {
    getEnvConfigStatus()
      .then((status) => setConfigStatus(status))
      .finally(() => setCheckingConfig(false));
  }, []);

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

  async function submitConfig(event: FormEvent) {
    event.preventDefault();
    setSavingConfig(true);
    try {
      const status = await saveEnvConfig({
        database_url: databaseUrl,
        jwt_secret: jwtSecret,
        api_addr: apiAddr,
      });
      setConfigStatus(status);
      toast.success("Configuration saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save configuration",
      );
    } finally {
      setSavingConfig(false);
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
          {needsConfig ? (
            <form className="flex flex-col gap-4" onSubmit={submitConfig}>
              <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                Database settings were not found. Enter them once to continue.
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="databaseUrl">DATABASE_URL</Label>
                <Input
                  id="databaseUrl"
                  value={databaseUrl}
                  onChange={(e) => setDatabaseUrl(e.currentTarget.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="jwtSecret">JWT_SECRET</Label>
                <Input
                  id="jwtSecret"
                  type="password"
                  value={jwtSecret}
                  onChange={(e) => setJwtSecret(e.currentTarget.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="apiAddr">API_ADDR</Label>
                <Input
                  id="apiAddr"
                  value={apiAddr}
                  onChange={(e) => setApiAddr(e.currentTarget.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={savingConfig}>
                {savingConfig ? "Saving..." : "Save Configuration"}
              </Button>
            </form>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="userId">User ID</Label>
                <Input
                  id="userId"
                  value={userId}
                  onChange={(e) => setUserId(e.currentTarget.value)}
                  required
                  disabled={checkingConfig}
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
                  disabled={checkingConfig}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={busy || checkingConfig}
              >
                {busy ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

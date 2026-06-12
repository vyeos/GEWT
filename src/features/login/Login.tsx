import { useState, type FormEvent } from "react";
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
import { login } from "@/lib/api";
import type { Me } from "@/types";

export function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

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
        </CardContent>
      </Card>
    </div>
  );
}

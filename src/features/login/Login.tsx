import { FormEvent, useState } from "react";
import { Shield } from "lucide-react";
import { toast, Toaster } from "sonner";
import { Field } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export function Login({ onLogin }: { onLogin: (token: string) => void }) {
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
    <main className="h-screen flex items-center justify-center">
      <Toaster richColors />
      <section className="flex items-center justify-center p-10">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Use seeded admin: admin / admin123 after running migrations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <Field label="User ID">
                <Input
                  value={userId}
                  onChange={(event) => setUserId(event.currentTarget.value)}
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                />
              </Field>
              <Button disabled={busy}>{busy ? "Signing in" : "Login"}</Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

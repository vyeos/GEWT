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
    <main className="grid min-h-screen grid-cols-[1.05fr_0.95fr]">
      <Toaster richColors />
      <section className="flex flex-col justify-between bg-primary p-10 text-primary-foreground">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-md bg-white/15">
            <Shield />
          </div>
          <div>
            <div className="text-2xl font-semibold">GEWT Fee Management</div>
            <div className="text-sm opacity-80">
              Cloud-secured branch ledger
            </div>
          </div>
        </div>
        <div className="max-w-xl">
          <h1 className="text-5xl font-semibold leading-tight tracking-normal">
            Admissions, receipts, and dues without branch leakage.
          </h1>
          <p className="mt-5 text-lg opacity-85">
            Admin works across Prantij, HMT, and Talod. Employees stay inside
            their assigned branch from login through every API call.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          {["Auto numbering", "September year", "Backup import"].map((item) => (
            <div key={item} className="rounded-md border border-white/20 p-3">
              {item}
            </div>
          ))}
        </div>
      </section>
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

import { useState } from "react";
import {
  Building2,
  CalendarClock,
  Download,
  FileDown,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { API_BASE, api } from "@/lib/api";
import type { Me } from "@/types";

export function Backup({ token, me }: { token: string; me: Me }) {
  const [frequency, setFrequency] = useState("monthly");
  const [customDays, setCustomDays] = useState(30);
  async function exportBackup() {
    const response = await fetch(`${API_BASE}/backups/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ format: "postgres_dump" }),
    });
    if (!response.ok) throw new Error(await response.text());
    const blob = await response.blob();
    const fileName =
      response.headers
        .get("content-disposition")
        ?.match(/filename="([^"]+)"/)?.[1] ?? `gewt-${Date.now()}.dump`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(`Backup downloaded: ${fileName}`);
  }
  async function importBackup() {
    if (me.role !== "admin")
      return toast.error("Only admins can import backups");
    await api("/backups/validate-import", token, {
      method: "POST",
      body: JSON.stringify({ file_name: "selected-backup.dump" }),
    });
    toast.info("Backup validated. Import merge selection would open next.");
  }
  return (
    <div className="grid grid-cols-2 gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Manual backup</CardTitle>
          <CardDescription>
            Available to admin and employee users.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button onClick={exportBackup}>
            <Download data-icon="inline-start" />
            Create backup
          </Button>
          <Separator />
          <Field label="Local backup location">
            <Input placeholder="/Users/shared/GEWT Backups" />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Scheduled backup</CardTitle>
          <CardDescription>
            Runs from each desktop app while it is open.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Frequency">
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="custom">Custom days</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {frequency === "custom" && (
            <Field label="Custom days">
              <Input
                type="number"
                min="1"
                value={customDays}
                onChange={(e) => setCustomDays(Number(e.currentTarget.value))}
              />
            </Field>
          )}
          <Button variant="outline">
            <CalendarClock data-icon="inline-start" />
            Save schedule
          </Button>
        </CardContent>
      </Card>
      <Card className="col-span-2">
        <CardHeader>
          <CardTitle>Import recovery</CardTitle>
          <CardDescription>
            Admin-only merge import with conflict policy and audit log.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button
            variant="outline"
            onClick={importBackup}
            disabled={me.role !== "admin"}
          >
            <Upload data-icon="inline-start" />
            Validate import
          </Button>
          <Button disabled={me.role !== "admin"}>
            <FileDown data-icon="inline-start" />
            Import: backup wins
          </Button>
          <Button disabled={me.role !== "admin"} variant="secondary">
            <Building2 data-icon="inline-start" />
            Import: cloud wins
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from "react";
import {
  Building2,
  CalendarClock,
  Download,
  FileDown,
  FolderOpen,
  HardDrive,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Manual backup</CardTitle>
            <CardDescription>
              Available to admin and employee users.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Download className="size-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Create backup</p>
                  <p className="text-sm text-muted-foreground">
                    Download a full database dump
                  </p>
                </div>
              </div>
              <Button size="sm" onClick={exportBackup}>
                Download
              </Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FolderOpen className="size-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Backup location</p>
                  <p className="text-sm text-muted-foreground">Local save folder</p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Local backup path</Label>
              <Input placeholder="/Users/shared/GEWT Backups" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scheduled backup</CardTitle>
            <CardDescription>
              Runs from each desktop app while it is open.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <HardDrive className="size-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Backup Frequency</p>
                  <p className="text-sm text-muted-foreground">
                    How often to run automatic backups
                  </p>
                </div>
              </div>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger className="w-32">
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
            </div>
            {frequency === "custom" && (
              <>
                <Separator />
                <div className="flex flex-col gap-2">
                  <Label>Custom interval (days)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={customDays}
                    onChange={(e) => setCustomDays(Number(e.currentTarget.value))}
                  />
                </div>
              </>
            )}
            <Button variant="outline" className="self-start">
              <CalendarClock className="size-4" />
              Save schedule
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Import recovery</CardTitle>
          <CardDescription>
            Admin-only merge import with conflict policy and audit log.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={importBackup}
            disabled={me.role !== "admin"}
          >
            <Upload className="size-4" />
            Validate import
          </Button>
          <Button disabled={me.role !== "admin"}>
            <FileDown className="size-4" />
            Import: backup wins
          </Button>
          <Button disabled={me.role !== "admin"} variant="secondary">
            <Building2 className="size-4" />
            Import: cloud wins
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

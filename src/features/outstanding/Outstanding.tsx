import { useEffect, useState } from "react";
import { AlertTriangle, IndianRupee, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { Branch, Me, OutstandingRow } from "@/types";

export function Outstanding({
  token,
  refreshKey,
  branches,
  me,
}: {
  token: string;
  refreshKey: number;
  branches: Branch[];
  me: Me;
}) {
  const [rows, setRows] = useState<OutstandingRow[]>([]);
  const [branchId, setBranchId] = useState("all");
  const visible = rows.filter(
    (row) => branchId === "all" || row.branch_id === branchId,
  );
  const total = visible.reduce((sum, row) => sum + row.pending, 0);

  useEffect(() => {
    async function loadOutstanding() {
      try {
        setRows(await api<OutstandingRow[]>("/reports/outstanding", token));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to load outstanding report",
        );
      }
    }

    void loadOutstanding();
  }, [token, refreshKey]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Students with pending</CardDescription>
            <Users className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{visible.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Total pending</CardDescription>
            <AlertTriangle className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{money(total)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Total due</CardDescription>
            <IndianRupee className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {money(visible.reduce((s, r) => s + r.total_due, 0))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Branch filter</CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={branchId}
              onValueChange={setBranchId}
              disabled={me.role !== "admin"}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All branches</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {visible.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No outstanding fees found
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Form</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.form_no}</TableCell>
                    <TableCell className="font-medium">{row.student_name}</TableCell>
                    <TableCell>{row.branch_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.course_name}</Badge>
                    </TableCell>
                    <TableCell>{row.current_period}</TableCell>
                    <TableCell className="text-right">{money(row.total_due)}</TableCell>
                    <TableCell className="text-right">{money(row.total_paid)}</TableCell>
                    <TableCell className="text-right font-medium text-destructive">
                      {money(row.pending)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

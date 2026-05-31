import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
import type { Branch, OutstandingRow } from "@/types";

const currentYear = new Date().getFullYear().toString();

function admissionYear(row: OutstandingRow) {
  return row.admission_date.slice(0, 4);
}

export function Outstanding({
  token,
  refreshKey,
  branches,
}: {
  token: string;
  refreshKey: number;
  branches: Branch[];
}) {
  const [rows, setRows] = useState<OutstandingRow[]>([]);
  const [batchYear, setBatchYear] = useState("");
  const [branchId, setBranchId] = useState("");
  const batchYears = useMemo(
    () =>
      Array.from(new Set(rows.map(admissionYear))).sort(
        (a, b) => Number(b) - Number(a),
      ),
    [rows],
  );
  const canShowTable = Boolean(batchYear && branchId);
  const visible = canShowTable
    ? rows.filter(
        (row) => admissionYear(row) === batchYear && row.branch_id === branchId,
      )
    : [];

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

  useEffect(() => {
    if (batchYears.length === 0) {
      setBatchYear("");
      return;
    }

    setBatchYear((selectedYear) => {
      if (selectedYear && batchYears.includes(selectedYear)) return selectedYear;
      if (batchYears.includes(currentYear)) return currentYear;
      return "";
    });
  }, [batchYears]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:w-[30rem]">
        <div className="flex flex-col gap-2">
          <Label>Batch year</Label>
          <Select value={batchYear} onValueChange={setBatchYear}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select batch" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {batchYears.map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Branch</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {!canShowTable ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Select batch year and branch to view outstanding fees
            </p>
          ) : visible.length === 0 ? (
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
                    <TableCell className="font-medium">
                      {row.student_name}
                    </TableCell>
                    <TableCell>{row.branch_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.course_name}</Badge>
                    </TableCell>
                    <TableCell>{row.current_period}</TableCell>
                    <TableCell className="text-right">
                      {money(row.total_due)}
                    </TableCell>
                    <TableCell className="text-right">
                      {money(row.total_paid)}
                    </TableCell>
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

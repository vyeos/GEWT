import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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
  const [batchYearOpen, setBatchYearOpen] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const selectedBranch = branches.find((branch) => branch.id === branchId);
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
          <Popover open={batchYearOpen} onOpenChange={setBatchYearOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={batchYearOpen}
                className="w-full justify-between font-normal"
              >
                {batchYear ? (
                  <span>{batchYear}</span>
                ) : (
                  <span className="text-muted-foreground">Select batch</span>
                )}
                <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-(--radix-popover-trigger-width) p-0"
              align="start"
            >
              {batchYears.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No results found
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto p-1">
                  {batchYears.map((year) => (
                    <button
                      key={year}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                        batchYear === year && "bg-accent",
                      )}
                      onClick={() => {
                        setBatchYear(year);
                        setBatchYearOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4 shrink-0",
                          batchYear === year ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {year}
                    </button>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Branch</Label>
          <Popover open={branchOpen} onOpenChange={setBranchOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={branchOpen}
                className="w-full justify-between font-normal"
              >
                {selectedBranch ? (
                  <span>{selectedBranch.name}</span>
                ) : (
                  <span className="text-muted-foreground">Select branch</span>
                )}
                <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-(--radix-popover-trigger-width) p-0"
              align="start"
            >
              {branches.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No results found
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto p-1">
                  {branches.map((branch) => (
                    <button
                      key={branch.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                        branchId === branch.id && "bg-accent",
                      )}
                      onClick={() => {
                        setBranchId(branch.id);
                        setBranchOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4 shrink-0",
                          branchId === branch.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {branch.name}
                    </button>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
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

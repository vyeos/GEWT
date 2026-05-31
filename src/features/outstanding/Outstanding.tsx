import { useState } from "react";
import { DataTable, Row } from "@/components/app/DataTable";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { money } from "@/lib/format";
import type { Branch, Me, OutstandingRow } from "@/types";

export function Outstanding({
  rows,
  branches,
  me,
}: {
  rows: OutstandingRow[];
  branches: Branch[];
  me: Me;
}) {
  const [branchId, setBranchId] = useState("all");
  const visible = rows.filter(
    (row) => branchId === "all" || row.branch_id === branchId,
  );
  const total = visible.reduce((sum, row) => sum + row.pending, 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{visible.length}</CardTitle>
            <CardDescription>Students with pending fees</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{money(total)}</CardTitle>
            <CardDescription>Total pending</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Branch filter</CardTitle>
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
          </CardHeader>
        </Card>
      </div>
      <DataTable
        columns="90px 1.3fr 1fr 1fr 1fr 1fr 1fr 110px"
        headers={[
          "Form",
          "Student",
          "Branch",
          "Course",
          "Period",
          "Due",
          "Paid",
          "Pending",
        ]}
      >
        {visible.map((row) => (
          <Row key={row.id} columns="90px 1.3fr 1fr 1fr 1fr 1fr 1fr 110px">
            <span>{row.form_no}</span>
            <strong>{row.student_name}</strong>
            <span>{row.branch_name}</span>
            <span>{row.course_name}</span>
            <span>{row.current_period}</span>
            <span>{money(row.total_due)}</span>
            <span>{money(row.total_paid)}</span>
            <Badge variant="destructive">{money(row.pending)}</Badge>
          </Row>
        ))}
      </DataTable>
    </div>
  );
}

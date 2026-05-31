import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function DataTable({
  columns,
  headers,
  children,
}: {
  columns: string;
  headers: string[];
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-auto">
        <div
          className="table-grid border-b bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          style={{ gridTemplateColumns: columns }}
        >
          {headers.map((header) => (
            <span key={header}>{header}</span>
          ))}
        </div>
        <div className="divide-y">{children}</div>
      </div>
    </Card>
  );
}

export function Row({
  columns,
  children,
}: {
  columns: string;
  children: ReactNode;
}) {
  return (
    <div
      className="table-grid px-4 py-3 text-sm"
      style={{ gridTemplateColumns: columns }}
    >
      {children}
    </div>
  );
}

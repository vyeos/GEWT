import { createPortal } from "react-dom";
import { money } from "@/lib/format";
import type { Course } from "@/types";

export type OutstandingPrintCell = {
  year: number;
  // null marks a year the student has not reached yet (rendered as "—").
  pending: number | null;
};

export type OutstandingPrintRow = {
  id: string;
  form_no: string;
  student_name: string;
  current_period: string;
  cells: OutstandingPrintCell[];
  pending: number;
};

export function OutstandingPrint({
  course,
  branchName,
  admissionYear,
  date,
  yearLabels,
  rows,
}: {
  course: Course | undefined;
  branchName: string | undefined;
  admissionYear: string;
  date: string;
  yearLabels: { year: number; label: string }[];
  rows: OutstandingPrintRow[];
}) {
  if (rows.length === 0)
    return createPortal(<div id="outstanding-print" />, document.body);

  const totalPending = rows.reduce((sum, row) => sum + row.pending, 0);

  return createPortal(
    <div id="outstanding-print">
      <div className="flex flex-col gap-4 px-[8mm] py-[10mm] font-['Geist',Arial,sans-serif] text-[12px] text-black">
        <div className="flex items-end justify-between gap-4 border-b-2 border-black pb-3">
          <div>
            <div className="text-[18px] font-bold uppercase leading-tight">
              Outstanding Fees Report
            </div>
            <div className="text-[13px]">
              {course?.name}
              {branchName ? (
                <span className="text-neutral-600"> · {branchName}</span>
              ) : null}
              <span className="text-neutral-600">
                {" "}
                · Admission Year {admissionYear}
              </span>
            </div>
          </div>
          <div className="text-right text-[12px]">Date: {date}</div>
        </div>

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-1.5 pr-2 font-bold">Sr. No.</th>
              <th className="py-1.5 pr-2 font-bold">Form No</th>
              <th className="py-1.5 pr-2 font-bold">Name</th>
              <th className="py-1.5 pr-2 font-bold">Period</th>
              {yearLabels.map(({ year, label }) => (
                <th key={year} className="py-1.5 pl-2 text-right font-bold">
                  {label}
                </th>
              ))}
              <th className="py-1.5 pl-2 text-right font-bold">Pending</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id} className="border-b border-neutral-300">
                <td className="py-1.5 pr-2 align-top tabular-nums">
                  {index + 1}
                </td>
                <td className="py-1.5 pr-2 align-top">{row.form_no}</td>
                <td className="py-1.5 pr-2 align-top font-medium">
                  {row.student_name}
                </td>
                <td className="py-1.5 pr-2 align-top">{row.current_period}</td>
                {row.cells.map((cell) => (
                  <td
                    key={cell.year}
                    className="py-1.5 pl-2 text-right align-top tabular-nums"
                  >
                    {cell.pending === null ? "—" : money(cell.pending)}
                  </td>
                ))}
                <td className="py-1.5 pl-2 text-right align-top font-semibold tabular-nums">
                  {money(row.pending)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-bold">
              <td
                className="py-1.5 pr-2"
                colSpan={4 + yearLabels.length}
              >
                Total ({rows.length}{" "}
                {rows.length === 1 ? "student" : "students"})
              </td>
              <td className="py-1.5 pl-2 text-right tabular-nums">
                {money(totalPending)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>,
    document.body,
  );
}

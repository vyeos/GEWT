import { amountInWords, money } from "@/lib/format";
import { formatCourseYear, getCurrentCourseYear } from "@/lib/course-duration";
import { PrintPage } from "@/components/print/PrintPage";
import type { Branch, Course, PaymentMode, Student } from "@/types";

export type PrintableReceipt = {
  receipt_no: string | number;
  receipt_date: string;
  fee_type: string;
  payment_mode: PaymentMode;
  amount_paid: number;
  reference_no: string | null;
};

export function ReceiptPrint({
  student,
  branch,
  course,
  receipt,
  academicYearStartMonth,
}: {
  student: Student | undefined;
  branch: Branch | undefined;
  course: Course | undefined;
  receipt: PrintableReceipt | null;
  academicYearStartMonth: number;
}) {
  if (!student || !receipt) return <div id="receipt-print" />;

  const year = getCurrentCourseYear(student, academicYearStartMonth);

  return (
    <div id="receipt-print">
      <PrintPage letterhead={course?.letterhead}>
        <div className="mb-6 text-center text-lg font-semibold uppercase tracking-wide">
          Fee Receipt
        </div>

        <div className="mb-6 flex justify-between">
          <span>
            <b>Receipt No:</b> {receipt.receipt_no}
          </span>
          <span>
            <b>Date:</b> {receipt.receipt_date}
          </span>
        </div>

        <table className="mb-6 w-full border-collapse">
          <tbody>
            <Row label="Student Name" value={student.student_name} />
            <Row label="Form No" value={student.form_no} />
            <Row
              label="Course"
              value={`${student.course_name}${branch ? ` — ${branch.name}` : ""}`}
            />
            <Row label="Current Year" value={formatCourseYear(year)} />
            {student.parent_phone && (
              <Row label="Parent Phone" value={student.parent_phone} />
            )}
          </tbody>
        </table>

        <table className="mb-6 w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-black">
              <th className="py-1.5">Fee Type</th>
              <th className="py-1.5">Payment Mode</th>
              <th className="py-1.5">Remarks</th>
              <th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-black/40">
              <td className="py-1.5">{receipt.fee_type || "Tuition"}</td>
              <td className="py-1.5">{receipt.payment_mode}</td>
              <td className="py-1.5">{receipt.reference_no || "—"}</td>
              <td className="py-1.5 text-right">{money(receipt.amount_paid)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-1.5" colSpan={3}>
                Total
              </td>
              <td className="py-1.5 text-right">{money(receipt.amount_paid)}</td>
            </tr>
          </tbody>
        </table>

        <p>
          <b>Amount in words:</b> {amountInWords(receipt.amount_paid)}
        </p>

        <div className="mt-auto flex justify-end">
          <div className="text-center">
            <div className="mb-1 h-12" />
            <div className="border-t border-black px-8 pt-1">
              Authorised Signature
            </div>
          </div>
        </div>
      </PrintPage>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="w-40 py-1 align-top font-semibold">{label}</td>
      <td className="py-1 align-top">: {value}</td>
    </tr>
  );
}

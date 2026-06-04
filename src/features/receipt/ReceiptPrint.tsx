import { amountInWords, money } from "@/lib/format";
import { formatCourseYear, getCurrentCourseYear } from "@/lib/course-duration";
import type { Branch, PaymentMode, Student } from "@/types";

export type PrintableReceipt = {
  receipt_no: string | number;
  receipt_date: string;
  fee_type: string;
  payment_mode: PaymentMode;
  amount_paid: number;
  reference_no: string | null;
};

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Letterheads are keyed by branch code + course name so the same course in
// different branches can carry its own header, using names you control
// (course ids are random UUIDs). Drop the images in public/letterheads/.
// The <img> below tries each candidate in order and falls back to the next
// on error, so a missing file degrades gracefully:
//   1. /letterheads/<BRANCH_CODE>-<course-name>.png  e.g. PRT-bca.png
//   2. /letterheads/<BRANCH_CODE>.png                (one header per branch)
//   3. /logo.png                                     (default placeholder)
function letterheadCandidates(branch: Branch | undefined, courseName: string) {
  const candidates: string[] = [];
  if (branch) {
    candidates.push(`/letterheads/${branch.code}-${slug(courseName)}.png`);
    candidates.push(`/letterheads/${branch.code}.png`);
  }
  candidates.push("/logo.png");
  return candidates;
}

export function ReceiptPrint({
  student,
  branch,
  receipt,
  academicYearStartMonth,
}: {
  student: Student | undefined;
  branch: Branch | undefined;
  receipt: PrintableReceipt | null;
  academicYearStartMonth: number;
}) {
  if (!student || !receipt) return <div id="receipt-print" />;

  const year = getCurrentCourseYear(student, academicYearStartMonth);
  const candidates = letterheadCandidates(branch, student.course_name);

  return (
    <div id="receipt-print">
      <div className="mx-auto max-w-[210mm] px-12 py-8 font-serif text-[15px] text-black">
        <img
          key={candidates[0]}
          src={candidates[0]}
          data-i="0"
          alt=""
          className="mb-6 w-full object-contain"
          onError={(e) => {
            const img = e.currentTarget;
            const next = Number(img.dataset.i) + 1;
            if (next < candidates.length) {
              img.dataset.i = String(next);
              img.src = candidates[next];
            }
          }}
        />

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

        <p className="mb-12">
          <b>Amount in words:</b> {amountInWords(receipt.amount_paid)}
        </p>

        <div className="flex justify-end">
          <div className="text-center">
            <div className="mb-1 h-12" />
            <div className="border-t border-black px-8 pt-1">
              Authorised Signature
            </div>
          </div>
        </div>
      </div>
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

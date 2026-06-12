import { createPortal } from "react-dom";
import { amountInWords, today } from "@/lib/format";
import {
  formatCoursePeriod,
  formatCourseYear,
  getCurrentCoursePeriod,
  getCurrentCourseYear,
} from "@/lib/course-duration";
import { PrintPage } from "@/components/print/PrintPage";
import type { Branch, Course, PaymentMode, Student } from "@/types";

export type PrintableReceipt = {
  receipt_no: string | number;
  receipt_date: string;
  fee_type: string;
  payment_mode: PaymentMode;
  amount_paid: number;
  reference_no: string | null;
  // The first print, triggered right when the receipt is saved, is the
  // original; every reprint afterwards is marked as a duplicate.
  original: boolean;
};

export function ReceiptPrint({
  student,
  course,
  receipt,
}: {
  student: Student | undefined;
  branch: Branch | undefined;
  course: Course | undefined;
  receipt: PrintableReceipt | null;
}) {
  if (!student || !receipt)
    return createPortal(<div id="receipt-print" />, document.body);

  const year = getCurrentCourseYear(student);
  const period = getCurrentCoursePeriod(student);
  const periodLabel = `${formatCourseYear(year)}-${formatCoursePeriod(
    student,
    period,
  )}`;
  const receiptYear = receipt.receipt_date.slice(0, 4);
  const paymentDetail = receipt.reference_no
    ? `${receipt.payment_mode} / ${receipt.reference_no}`
    : receipt.payment_mode;

  return createPortal(
    <div id="receipt-print">
      <PrintPage
        letterhead={course?.letterhead}
        pageClassName="h-[148.5mm]"
        letterheadClassName="h-[297mm]"
        contentClassName="inset-x-[3%] top-[58mm] bottom-auto text-[13px]"
      >
        <div className="border-y-2 border-black py-1.5">
          <div className="mb-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div>
              Receipt No. : <span>{uppercase(String(receipt.receipt_no))}</span>
            </div>
            <div className="font-bold">
              {receipt.original ? "Original Copy" : "Duplicate Copy"}
            </div>
            <div className="text-right">
              Date. : <span>{displayDate(today())}</span>
            </div>
          </div>

          <div className="mb-2.5 grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(8rem,12rem)] items-end gap-x-2">
            <span>Received with thanks from</span>
            <UnderlinedValue value={student.student_name} />
            <span>Course :</span>
            <UnderlinedValue value={`${student.course_name}: ${periodLabel}`} />
          </div>

          <div className="mb-2.5 grid grid-cols-[auto_auto_minmax(0,1fr)] items-end gap-x-2">
            <span>the sum of Rs.</span>
            <span>(In words)</span>
            <UnderlinedValue value={receiptWords(receipt.amount_paid)} />
          </div>

          <div className="mb-4 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-end gap-x-2">
            <span>by</span>
            <UnderlinedValue value={paymentDetail} />
            <span>Yr.</span>
            <UnderlinedValue value={receiptYear} />
          </div>

          <div className="mb-4 flex items-center gap-2.5">
            <div className="rounded border-2 border-black px-2 py-0.5 text-[20px] font-bold">
              Rs.
            </div>
            <div className="min-w-36 rounded border-2 border-black px-4 py-0.5 text-right text-[20px] font-bold">
              {amountNumber(receipt.amount_paid)}
            </div>
          </div>

          <div className="flex items-end justify-between gap-6 text-[14px]">
            <div className="whitespace-nowrap text-[10px] font-medium">
              * Subject to Sabarkantha Jurisdiction, &nbsp; * Fees Once are Paid
              non Refundable.
            </div>
            <div className="min-w-32 text-center">
              <div className="mb-1 h-8 border-b border-black" />
              <div className="font-bold">For, VIN</div>
            </div>
          </div>
        </div>
      </PrintPage>
    </div>,
    document.body,
  );
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function amountNumber(value: number) {
  return (value || 0).toFixed(2);
}

function receiptWords(value: number) {
  return amountInWords(value).replace(/^Rupees\s+/i, "");
}

function uppercase(value: string) {
  return value.toUpperCase();
}

function UnderlinedValue({ value }: { value: string }) {
  return (
    <span className="min-w-0 border-b-2 border-black px-1.5 text-left font-medium leading-5">
      {value ? uppercase(value) : "\u00a0"}
    </span>
  );
}

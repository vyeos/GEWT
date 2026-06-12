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
        contentClassName="inset-x-[3%] top-[21.5%] bottom-auto text-[16px]"
      >
        <div className="border-y-2 border-black py-2">
          <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div>
              Receipt No. : <span>{uppercase(String(receipt.receipt_no))}</span>
            </div>
            <div className="font-bold">Original Copy</div>
            <div className="text-right">
              Date. : <span>{displayDate(today())}</span>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(8rem,12rem)] items-end gap-x-3">
            <span>Received with thanks from</span>
            <UnderlinedValue value={student.student_name} />
            <span>Course :</span>
            <UnderlinedValue value={`${student.course_name}: ${periodLabel}`} />
          </div>

          <div className="mb-4 grid grid-cols-[auto_auto_minmax(0,1fr)] items-end gap-x-3">
            <span>the sum of Rs.</span>
            <span>(In words)</span>
            <UnderlinedValue value={receiptWords(receipt.amount_paid)} />
          </div>

          <div className="mb-7 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-end gap-x-3">
            <span>by</span>
            <UnderlinedValue value={paymentDetail} />
            <span>Yr.</span>
            <UnderlinedValue value={receiptYear} />
          </div>

          <div className="mb-7 flex items-center gap-3">
            <div className="rounded border-2 border-black px-2 py-0.5 text-[24px] font-bold">
              Rs.
            </div>
            <div className="min-w-44 rounded border-2 border-black px-5 py-0.5 text-right text-[24px] font-bold">
              {amountNumber(receipt.amount_paid)}
            </div>
          </div>

          <div className="flex items-end justify-between gap-8 text-[17px]">
            <div className="whitespace-nowrap text-[12px] font-medium">
              * Subject to Sabarkantha Jurisdiction, &nbsp; * Fees Once are Paid
              non Refundable.
            </div>
            <div className="min-w-32 text-center">
              <div className="mb-1 h-12 border-b border-black" />
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
    <span className="min-w-0 border-b-2 border-black px-2 text-left font-medium leading-7">
      {value ? uppercase(value) : "\u00a0"}
    </span>
  );
}

import { cleanup, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import type React from "react";
import { describe, expect, it } from "vitest";
import { AdmissionPrint } from "@/features/admission/AdmissionPrint";
import { OutstandingPrint, type OutstandingPrintRow } from "@/features/outstanding/OutstandingPrint";
import { ReceiptPrint } from "@/features/receipt/ReceiptPrint";
import {
  formatCourseYear,
  getCourseDuration,
  getCurrentCourseYear,
} from "@/lib/course-duration";
import { today } from "@/lib/format";
import type { Branch, Course, OutstandingRow, PaymentMode, Student } from "@/types";

type RenderReceipt = {
  id: string;
  receipt_no: string;
  receipt_date: string;
  student_id: string;
  branch_id: string;
  fee_type: string;
  amount_paid: number;
  payment_mode: string;
  reference_no: string | null;
  cancelled: boolean;
  cancelled_at: string | null;
};

type AdmissionPayload = {
  file_name: string;
  student: Student;
  course: Course;
  branch: Branch;
};

type ReceiptPayload = {
  file_name: string;
  receipt: RenderReceipt;
  student: Student;
  course: Course;
  branch: Branch;
};

type ReceiptStagePayload = {
  name: string;
  receipts: ReceiptPayload[];
};

type OutstandingStagePayload = {
  name: string;
  rows: OutstandingRow[];
};

type PrintPayload = {
  artifact_dir: string;
  admissions: AdmissionPayload[];
  receipt_stages: ReceiptStagePayload[];
  outstanding_stages: OutstandingStagePayload[];
};

const payloadPath = process.env.GEWT_PRINT_FLOW_INPUT;

function readPayload(): PrintPayload {
  if (!payloadPath) throw new Error("GEWT_PRINT_FLOW_INPUT is required");
  return JSON.parse(fs.readFileSync(payloadPath, "utf8")) as PrintPayload;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function findBuiltCss(): string | null {
  const assetsDir = path.resolve("dist/assets");
  if (!fs.existsSync(assetsDir)) return null;
  const cssFile = fs
    .readdirSync(assetsDir)
    .find((file) => file.startsWith("index-") && file.endsWith(".css"));
  return cssFile ? path.join(assetsDir, cssFile) : null;
}

function absolutizeAppAssetUrls(html: string) {
  const publicDir = path.resolve("public");
  return html.replace(/src="\//g, `src="file://${publicDir}/`);
}

function htmlDocument(title: string, body: string) {
  const css = findBuiltCss();
  const cssLink = css
    ? `<link rel="stylesheet" href="file://${css}">`
    : "<!-- Run `bun run build` before rendering to attach the compiled app CSS. -->";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    ${cssLink}
  </head>
  <body>
    ${absolutizeAppAssetUrls(body)}
  </body>
</html>
`;
}

function renderPrint(element: React.ReactElement, selector: string, title: string) {
  cleanup();
  render(element);
  const node = document.querySelector(selector);
  expect(node).toBeTruthy();
  return htmlDocument(title, node?.outerHTML ?? "");
}

function admissionHtml(payload: AdmissionPayload) {
  return renderPrint(
    <AdmissionPrint
      admission={{
        form_no: payload.student.form_no,
        admission_date: payload.student.admission_date,
        surname: payload.student.surname,
        student_name: payload.student.student_name,
        father_name: payload.student.father_name,
        category: payload.student.category,
        religion: payload.student.religion,
        caste: payload.student.caste,
        gender: payload.student.gender,
        aadhar: payload.student.aadhar,
        address: payload.student.address,
        district: payload.student.district,
        taluka: payload.student.taluka,
        pincode: payload.student.pincode,
        student_phone: payload.student.student_phone,
        parent_phone: payload.student.parent_phone,
        photo: payload.student.photo,
        yearly_fee: payload.student.fee_year_1,
        tuition_fee: payload.student.tuition_fee_year_1,
        other_fee: payload.student.other_fee_year_1,
      }}
      course={payload.course}
      branch={payload.branch}
    />,
    "#admission-print",
    `Admission ${payload.student.form_no}`,
  );
}

function receiptHtml(payload: ReceiptPayload) {
  return renderPrint(
    <ReceiptPrint
      student={payload.student}
      branch={payload.branch}
      course={payload.course}
      receipt={{
        receipt_no: payload.receipt.receipt_no,
        receipt_date: payload.receipt.receipt_date,
        fee_type: payload.receipt.fee_type,
        payment_mode: payload.receipt.payment_mode as PaymentMode,
        amount_paid: payload.receipt.amount_paid,
        reference_no: payload.receipt.reference_no,
        original: true,
      }}
    />,
    "#receipt-print",
    `Receipt ${payload.receipt.receipt_no}`,
  );
}

function yearBreakdown(row: OutstandingRow, year: number) {
  return row.year_breakdown.find((breakdown) => breakdown.year === year);
}

function outstandingHtml(stageName: string, course: Course, rows: OutstandingRow[]) {
  const duration = getCourseDuration(course);
  const courseYears = Array.from(
    { length: duration.totalYears },
    (_, index) => index + 1,
  );
  const printRows: OutstandingPrintRow[] = rows.map((row) => {
    const studentCurrentYear = getCurrentCourseYear(row);
    return {
      id: row.id,
      form_no: row.form_no,
      student_name: row.student_name,
      current_period: row.current_period,
      cells: courseYears.map((year) => ({
        year,
        pending:
          year > studentCurrentYear ? null : (yearBreakdown(row, year)?.pending ?? 0),
      })),
      pending: row.pending,
    };
  });

  return renderPrint(
    <OutstandingPrint
      course={course}
      branchName={rows[0]?.branch_name}
      admissionYear="2026"
      date={today()}
      yearLabels={courseYears.map((year) => ({ year, label: formatCourseYear(year) }))}
      rows={printRows}
    />,
    "#outstanding-print",
    `Outstanding ${stageName} ${course.name}`,
  );
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

function writeAppPrint(pathName: string, content: string) {
  ensureDir(path.dirname(pathName));
  fs.writeFileSync(pathName, content);
}

describe.skipIf(!payloadPath)("elaborate print renderer", () => {
  it("saves admission, receipt, and outstanding documents through app print components", () => {
    const payload = readPayload();

    for (const admission of payload.admissions) {
      writeAppPrint(
        path.join(payload.artifact_dir, "admission-forms", admission.file_name),
        admissionHtml(admission),
      );
    }

    for (const stage of payload.receipt_stages) {
      for (const receipt of stage.receipts) {
        writeAppPrint(
          path.join(payload.artifact_dir, "receipts", sanitize(stage.name), receipt.file_name),
          receiptHtml(receipt),
        );
      }
    }

    for (const stage of payload.outstanding_stages) {
      const rowsByCourse = new Map<string, OutstandingRow[]>();
      for (const row of stage.rows) {
        rowsByCourse.set(row.course_id, [...(rowsByCourse.get(row.course_id) ?? []), row]);
      }
      if (rowsByCourse.size === 0) {
        writeAppPrint(
          path.join(
            payload.artifact_dir,
            "outstanding",
            sanitize(stage.name),
            "_NO_OUTSTANDING_TO_PRINT.txt",
          ),
          "The app's outstanding print button has no printable rows at this checkpoint.",
        );
        continue;
      }

      for (const [courseId, rows] of rowsByCourse) {
        const course = payload.admissions.find(
          (admission) => admission.course.id === courseId,
        )?.course;
        expect(course).toBeTruthy();
        if (!course) continue;

        writeAppPrint(
          path.join(
            payload.artifact_dir,
            "outstanding",
            sanitize(stage.name),
            `${sanitize(course.name)}.html`,
          ),
          outstandingHtml(stage.name, course, rows),
        );
      }
    }

    cleanup();
  });
});

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReceiptPrint } from "@/features/receipt/ReceiptPrint";
import { makeStudent } from "@/test/factories";
import type { Branch, Course } from "@/types";

const branch: Branch = { id: "b1", code: "PRJ", name: "Prantij" };
const course: Course = {
  id: "c1",
  branch_id: "b1",
  name: "B.Sc.",
  duration: 6,
  duration_type: "semester",
  letterhead: null,
  active: true,
};

describe("ReceiptPrint", () => {
  it("prints the receipt's own date (DD/MM/YYYY), not today's date", () => {
    render(
      <ReceiptPrint
        student={makeStudent()}
        branch={branch}
        course={course}
        receipt={{
          receipt_no: "PRJ-1",
          receipt_date: "2026-09-05",
          fee_type: "Tuition",
          payment_mode: "Cash",
          amount_paid: 500,
          reference_no: null,
          // A reprint ("Duplicate Copy") must still carry the original date.
          original: false,
        }}
      />,
    );

    const node = document.getElementById("receipt-print");
    expect(node?.textContent).toContain("05/09/2026");
  });
});

import { money } from "@/lib/format";
import { getCourseDuration } from "@/lib/course-duration";
import { PrintPage } from "@/components/print/PrintPage";
import type { Branch, Course } from "@/types";

export type PrintableAdmission = {
  form_no: string;
  admission_date: string;
  surname: string;
  student_name: string;
  father_name: string;
  category: string;
  religion: string;
  caste: string;
  gender: string;
  aadhar: string;
  address: string;
  student_phone: string;
  parent_phone: string;
  yearly_fee: number;
  tuition_fee: number;
  other_fee: number;
};

export function AdmissionPrint({
  admission,
  course,
  branch,
}: {
  admission: PrintableAdmission | null;
  course: Course | undefined;
  branch: Branch | undefined;
}) {
  if (!admission) return <div id="admission-print" />;

  const courseLine = course
    ? `${course.name}${branch ? ` — ${branch.name}` : ""}`
    : "";
  const duration = course ? getCourseDuration(course).label : "";

  return (
    <div id="admission-print">
      <PrintPage letterhead={course?.letterhead}>
        <div className="mb-4 text-center text-lg font-semibold uppercase tracking-wide">
          Admission Form
        </div>

        <div className="mb-4 flex justify-between">
          <span>
            <b>Form No:</b> {admission.form_no}
          </span>
          <span>
            <b>Date:</b> {admission.admission_date}
          </span>
        </div>

        <table className="mb-3 w-full border-collapse">
          <tbody>
            {courseLine && <Row label="Course" value={courseLine} />}
            {duration && <Row label="Duration" value={duration} />}
            <Row label="Surname" value={admission.surname} />
            <Row label="Student's Name" value={admission.student_name} />
            <Row label="Father's Name" value={admission.father_name} />
            <Row label="Category" value={admission.category} />
            {admission.religion && (
              <Row label="Religion" value={admission.religion} />
            )}
            {admission.caste && <Row label="Caste" value={admission.caste} />}
            <Row label="Gender" value={admission.gender} />
            {admission.aadhar && (
              <Row label="Aadhar No" value={admission.aadhar} />
            )}
            {admission.student_phone && (
              <Row label="Student Phone" value={admission.student_phone} />
            )}
            {admission.parent_phone && (
              <Row label="Parent Phone" value={admission.parent_phone} />
            )}
            {admission.address && (
              <Row label="Address" value={admission.address} />
            )}
          </tbody>
        </table>

        <table className="mb-3 w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-black">
              <th className="py-1.5">Fee Type</th>
              <th className="py-1.5 text-right">Amount (per year)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-black/40">
              <td className="py-1.5">Tuition Fee</td>
              <td className="py-1.5 text-right">{money(admission.tuition_fee)}</td>
            </tr>
            <tr className="border-b border-black/40">
              <td className="py-1.5">Other Fee</td>
              <td className="py-1.5 text-right">{money(admission.other_fee)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-1.5">Yearly Fee</td>
              <td className="py-1.5 text-right">{money(admission.yearly_fee)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-auto flex justify-between">
          <div className="text-center">
            <div className="mb-1 h-12" />
            <div className="border-t border-black px-8 pt-1">
              Student Signature
            </div>
          </div>
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
      <td className="w-40 py-0.5 align-top font-semibold">{label}</td>
      <td className="py-0.5 align-top">: {value}</td>
    </tr>
  );
}

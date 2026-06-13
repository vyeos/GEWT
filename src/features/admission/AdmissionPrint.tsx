import { createPortal } from "react-dom";
import { PrintPage } from "@/components/print/PrintPage";
import { displayDate, uppercase } from "@/lib/format";
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
  district: string;
  taluka: string;
  pincode: string;
  student_phone: string;
  parent_phone: string;
  photo: string;
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
  if (!admission)
    return createPortal(<div id="admission-print" />, document.body);

  const admissionYear = admission.admission_date.slice(0, 4);
  const courseLine = course?.name ?? "";

  return createPortal(
    <div id="admission-print">
      <PrintPage
        letterhead={course?.letterhead}
        contentClassName="inset-x-[3%] top-[58mm] bottom-[17%] text-[15px]"
      >
        <div className="pb-1.5 pt-2">
          <div className="mb-4 grid min-h-8 grid-cols-[1fr_auto_1fr] items-start gap-3">
            <div className="min-w-0 break-words text-[16px] leading-tight">
              <span className="font-bold">Form No:</span>
              <span className="ml-3">{uppercase(admission.form_no)}</span>
            </div>
            <div className="border border-black px-8 py-0.5 text-center text-[18px] font-bold uppercase leading-tight">
              Admission Form
            </div>
            <div className="flex justify-end">
              {admission.photo && (
                <img
                  src={admission.photo}
                  alt=""
                  className="h-[120px] w-[96px] border border-black object-cover"
                />
              )}
            </div>
          </div>

          <div className="mb-14 grid grid-cols-3 gap-6 text-center">
            <LineField label="Admission Year" value={admissionYear} />
            {courseLine && <LineField label="Admission For" value={courseLine} />}
            {branch && <LineField label="Branch" value={branch.name} />}
          </div>

          <div className="mb-2 text-[16px] font-bold">Name of the Applicant</div>
          <div className="mb-3 grid grid-cols-3 gap-6 text-center">
            <LineField label="Surname" value={admission.surname} />
            <LineField label="Student Name" value={admission.student_name} />
            <LineField label="Father Name" value={admission.father_name} />
          </div>

          <div className="mb-3 grid grid-cols-4 gap-5 text-center">
            {admission.religion && (
              <LineField label="Religion" value={admission.religion} />
            )}
            {admission.caste && (
              <LineField label="Cast" value={admission.caste} />
            )}
            <LineField label="Category" value={admission.category} />
            <LineField label="Gender" value={admission.gender} />
          </div>

          {admission.address && (
            <BlockLine label="Complete Native Address :" value={admission.address} />
          )}

          {(admission.district || admission.taluka || admission.pincode) && (
            <div className="mt-3 grid grid-cols-3 gap-6 text-center">
              {admission.district && (
                <LineField label="District" value={admission.district} />
              )}
              {admission.taluka && (
                <LineField label="Taluka" value={admission.taluka} />
              )}
              {admission.pincode && (
                <LineField label="Pincode" value={admission.pincode} />
              )}
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-8 text-center">
            {admission.student_phone && (
              <LineField
                label="Student Mobile No"
                value={admission.student_phone}
              />
            )}
            {admission.parent_phone && (
              <LineField
                label="Parent Mobile No"
                value={admission.parent_phone}
              />
            )}
          </div>

          <div className="mt-6 grid grid-cols-3 gap-5 text-center">
            <LineField label="Admission Date" value={displayDate(admission.admission_date)} />
          </div>
        </div>
      </PrintPage>
    </div>,
    document.body,
  );
}

function LineField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 font-bold leading-tight">{label}</div>
      <div className="min-h-6 border-b-2 border-black px-1 text-[16px] leading-6">
        {uppercase(value)}
      </div>
    </div>
  );
}

function BlockLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2">
      <div className="mb-2 font-bold">{label}</div>
      <div className="min-h-7 border-b-2 border-black text-[16px] leading-7">
        {uppercase(value)}
      </div>
    </div>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { paymentModes } from "@/data/seeds";
import { api } from "@/lib/api";
import { today } from "@/lib/format";
import type { PaymentMode, Student } from "@/types";

export function Receipt({
  token,
  students,
  onSaved,
}: {
  token: string;
  students: Student[];
  onSaved: () => void;
}) {
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [amount, setAmount] = useState(0);
  const [reference, setReference] = useState("");
  const requiresRef = mode !== "Cash";

  useEffect(() => {
    if (!studentId && students[0]) setStudentId(students[0].id);
  }, [students, studentId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (requiresRef && !reference) {
      toast.error("Reference is required for non-cash payments");
      return;
    }
    try {
      await api("/receipts", token, {
        method: "POST",
        body: JSON.stringify({
          student_id: studentId,
          receipt_date: today(),
          amount_paid: amount,
          payment_mode: mode,
          reference_no: reference,
        }),
      });
      toast.success("Receipt saved");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Receipt failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fee Receipt</CardTitle>
        <CardDescription>
          Receipt number starts at 1 and increments inside a database
          transaction.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-4 gap-4">
          <Field label="Student">
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select student" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {students.map((student) => (
                    <SelectItem key={student.id} value={student.id}>
                      {student.form_no} - {student.student_name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Amount paid">
            <Input
              required
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(Number(e.currentTarget.value))}
            />
          </Field>
          <Field label="Payment mode">
            <Select
              value={mode}
              onValueChange={(value) => setMode(value as PaymentMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {paymentModes.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field label={requiresRef ? "Reference number" : "Reference"}>
            <Input
              value={reference}
              disabled={!requiresRef}
              required={requiresRef}
              onChange={(e) => setReference(e.currentTarget.value)}
            />
          </Field>
          <div className="col-span-4 flex justify-end">
            <Button>
              <ReceiptText data-icon="inline-start" />
              Save receipt
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

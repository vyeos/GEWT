import type { Branch, PaymentMode } from "@/types";

export const branchesSeed: Branch[] = [
  { id: "seed-prantij", code: "PRT", name: "Prantij" },
  { id: "seed-hmt", code: "HMT", name: "HMT" },
  { id: "seed-talod", code: "TLD", name: "Talod" },
];

export const paymentModes: PaymentMode[] = [
  "Cash",
  "UPI",
  "DD",
  "Cheque",
  "NEFT",
  "RTGS",
];

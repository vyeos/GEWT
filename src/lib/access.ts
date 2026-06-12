import type { Me, Screen, User } from "@/types";

export type PageAccessField =
  | "can_admission"
  | "can_receipt"
  | "can_outstanding"
  | "can_students"
  | "can_promote";

export const PAGE_ACCESS: {
  screen: Screen;
  field: PageAccessField;
  label: string;
}[] = [
  { screen: "admission", field: "can_admission", label: "Admission" },
  { screen: "receipt", field: "can_receipt", label: "Fee Receipt" },
  { screen: "outstanding", field: "can_outstanding", label: "Outstanding" },
  { screen: "students", field: "can_students", label: "Students" },
  { screen: "promote", field: "can_promote", label: "Promote" },
];

export function canAccessScreen(user: Pick<User, PageAccessField | "role">, screen: Screen) {
  const page = PAGE_ACCESS.find((item) => item.screen === screen);
  if (page) return user[page.field];
  if (screen === "utility") return user.role === "admin";
  return true;
}

export function firstAccessibleScreen(user: Me): Screen {
  return (
    PAGE_ACCESS.find((item) => user[item.field])?.screen ??
    (user.role === "admin" ? "utility" : "backup")
  );
}

export function pageAccessLabels(user: Pick<User, PageAccessField>): string[] {
  return PAGE_ACCESS.filter((item) => user[item.field]).map((item) => item.label);
}

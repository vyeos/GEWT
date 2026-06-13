import type { Branch, Me, Screen, User } from "@/types";

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
  // Admins always have every page; the per-page flags only scope employees.
  if (user.role === "admin") return true;
  const page = PAGE_ACCESS.find((item) => item.screen === screen);
  if (page) return user[page.field];
  if (screen === "utility") return false;
  return true;
}

export function firstAccessibleScreen(user: Me): Screen {
  if (user.role === "admin") return "admission";
  return PAGE_ACCESS.find((item) => user[item.field])?.screen ?? "backup";
}

export function pageAccessLabels(user: Pick<User, PageAccessField>): string[] {
  return PAGE_ACCESS.filter((item) => user[item.field]).map((item) => item.label);
}

/// The branches a user may act on: all branches for admins, only their own for
/// employees. (The backend already scopes employee queries; this keeps the UI
/// pickers consistent.)
export function branchesForUser(
  user: Pick<User, "role" | "branch_id">,
  branches: Branch[],
): Branch[] {
  return user.role === "admin"
    ? branches
    : branches.filter((branch) => branch.id === user.branch_id);
}

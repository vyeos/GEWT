import { describe, expect, it } from "vitest";
import { canAccessScreen, firstAccessibleScreen, pageAccessLabels } from "@/lib/access";
import { makeMe, makeUser } from "@/test/factories";

describe("access helpers", () => {
  it("uses per-page access flags for employees", () => {
    const user = makeUser({ role: "employee", can_receipt: false });

    expect(canAccessScreen(user, "admission")).toBe(true);
    expect(canAccessScreen(user, "receipt")).toBe(false);
  });

  it("gives admins every page regardless of per-page flags", () => {
    const admin = makeUser({
      role: "admin",
      can_admission: false,
      can_receipt: false,
      can_students: false,
    });

    expect(canAccessScreen(admin, "admission")).toBe(true);
    expect(canAccessScreen(admin, "receipt")).toBe(true);
    expect(canAccessScreen(admin, "students")).toBe(true);
    expect(canAccessScreen(admin, "utility")).toBe(true);
  });

  it("keeps utility admin-only and backup open to signed-in users", () => {
    expect(canAccessScreen(makeUser({ role: "employee" }), "utility")).toBe(false);
    expect(canAccessScreen(makeUser({ role: "admin" }), "utility")).toBe(true);
    expect(canAccessScreen(makeUser({ role: "employee" }), "backup")).toBe(true);
  });

  it("finds the first available workflow with role-based fallback", () => {
    const noPageAccess = {
      can_admission: false,
      can_receipt: false,
      can_outstanding: false,
      can_students: false,
      can_promote: false,
    };

    expect(firstAccessibleScreen(makeMe({ role: "employee", can_admission: false }))).toBe(
      "receipt",
    );
    // Admins always land on the first page; their flags never gate them.
    expect(firstAccessibleScreen(makeMe({ role: "admin", ...noPageAccess }))).toBe("admission");
    expect(firstAccessibleScreen(makeMe({ role: "employee", ...noPageAccess }))).toBe("backup");
  });

  it("returns labels for enabled page permissions", () => {
    expect(
      pageAccessLabels(
        makeUser({
          can_admission: true,
          can_receipt: false,
          can_outstanding: true,
          can_students: false,
          can_promote: true,
        }),
      ),
    ).toEqual(["Admission", "Outstanding", "Promote"]);
  });
});

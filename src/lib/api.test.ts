import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, login } from "@/lib/api";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("Tauri API compatibility layer", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    invokeMock.mockResolvedValue({ ok: true });
  });

  it("calls typed helpers with the Rust command names and argument casing", async () => {
    await login("admin", "secret");
    expect(invokeMock).toHaveBeenLastCalledWith("login", {
      userId: "admin",
      password: "secret",
    });

    await api("/branches", null);
    expect(invokeMock).toHaveBeenLastCalledWith("list_branches", undefined);
  });

  it("maps REST-style course and student requests onto Tauri commands", async () => {
    await api("/courses", null);
    expect(invokeMock).toHaveBeenLastCalledWith("list_courses", undefined);

    await api("/courses", null, {
      method: "POST",
      body: JSON.stringify({ name: "BCA" }),
    });
    expect(invokeMock).toHaveBeenLastCalledWith("create_course", {
      req: { name: "BCA" },
    });

    await api("/students?include_cancelled=true", null);
    expect(invokeMock).toHaveBeenLastCalledWith("list_students", {
      includeCancelled: true,
    });

    await api("/students/student-1/cancel", null, { method: "POST" });
    expect(invokeMock).toHaveBeenLastCalledWith("cancel_student", {
      id: "student-1",
    });
  });

  it("maps receipt and report routes with query parameters", async () => {
    await api("/receipts?student_id=student-1", null);
    expect(invokeMock).toHaveBeenLastCalledWith("list_receipts", {
      studentId: "student-1",
    });

    await api("/receipts", null, {
      method: "POST",
      body: JSON.stringify({ amount_paid: 500 }),
    });
    expect(invokeMock).toHaveBeenLastCalledWith("create_receipt", {
      req: { amount_paid: 500 },
    });

    await api("/reports/outstanding", null);
    expect(invokeMock).toHaveBeenLastCalledWith("outstanding_report", undefined);
  });

  it("turns string rejections from Tauri into Error instances", async () => {
    invokeMock.mockRejectedValueOnce("Invalid password");

    await expect(login("admin", "wrong")).rejects.toThrow("Invalid password");
  });

  it("rejects unsupported compatibility routes before invoking Rust", async () => {
    await expect(api("/unknown", null)).rejects.toThrow("Unsupported request: GET /unknown");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

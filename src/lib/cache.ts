import { invoke } from "@tauri-apps/api/core";
import type { Course, Me, Student } from "@/types";

export type SyncResult = {
  synced_count: number;
  is_initial: boolean;
};

export type CachedReceipt = {
  id: string;
  receipt_no: number;
  receipt_date: string;
  student_id: string;
  branch_id: string;
  fee_type: string;
  amount_paid: number;
  payment_mode: string;
  reference_no: string | null;
  updated_at: string;
};

export type SyncStatus = {
  courses: { last_synced: string | null; count: number };
  students: { last_synced: string | null; count: number };
  receipts: { last_synced: string | null; count: number };
};

export function syncScope(me: Me) {
  return me.role === "admin" ? "admin" : `branch:${me.branch_id}`;
}

export function syncCourses(token: string, scopeKey: string) {
  return invoke<SyncResult>("sync_courses", { token, scopeKey });
}

export function syncStudents(token: string, scopeKey: string) {
  return invoke<SyncResult>("sync_students", { token, scopeKey });
}

export function syncReceipts(token: string, scopeKey: string) {
  return invoke<SyncResult>("sync_receipts", { token, scopeKey });
}

export async function syncAll(token: string, me: Me) {
  const scopeKey = syncScope(me);
  return Promise.all([
    syncCourses(token, scopeKey),
    syncStudents(token, scopeKey),
    syncReceipts(token, scopeKey),
  ]);
}

export function getCachedCourses(branchId?: string): Promise<Course[]> {
  return invoke<Course[]>("get_cached_courses", {
    branchId: branchId ?? null,
  });
}

export function getCachedStudents(branchId?: string): Promise<Student[]> {
  return invoke<Student[]>("get_cached_students", {
    branchId: branchId ?? null,
  });
}

export function getCachedReceipts(
  studentId?: string,
  branchId?: string,
): Promise<CachedReceipt[]> {
  return invoke<CachedReceipt[]>("get_cached_receipts", {
    studentId: studentId ?? null,
    branchId: branchId ?? null,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cacheStudent(student: any) {
  return invoke("cache_student", { student });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cacheReceipt(receipt: any) {
  return invoke("cache_receipt", { receipt });
}

export function getSyncStatus(scopeKey: string) {
  return invoke<SyncStatus>("get_sync_status", { scopeKey });
}

export function resetCache() {
  return invoke("reset_cache");
}

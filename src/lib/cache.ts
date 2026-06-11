import { invoke } from "@tauri-apps/api/core";
import type { Course, Me, Student } from "@/types";

// The app is now fully local: the SQLite database IS the source of truth, so
// the former offline "cache + sync" layer is gone. These helpers are kept so the
// feature components don't have to change — reads go straight to the local DB
// and the old sync/cache write paths become no-ops.

export type SyncResult = {
  synced_count: number;
  is_initial: boolean;
};

export type CachedReceipt = {
  id: string;
  receipt_no: string;
  receipt_date: string;
  student_id: string;
  branch_id: string;
  fee_type: string;
  amount_paid: number;
  payment_mode: string;
  reference_no: string | null;
};

export type SyncStatus = {
  courses: { last_synced: string | null; count: number };
  students: { last_synced: string | null; count: number };
  receipts: { last_synced: string | null; count: number };
};

export function syncScope(me: Me) {
  return me.role === "admin" ? "admin" : `branch:${me.branch_id}`;
}

const noopSync: SyncResult = { synced_count: 0, is_initial: false };

export function syncCourses(_token?: string, _scopeKey?: string): Promise<SyncResult> {
  return Promise.resolve(noopSync);
}

export function syncStudents(_token?: string, _scopeKey?: string): Promise<SyncResult> {
  return Promise.resolve(noopSync);
}

export function syncReceipts(_token?: string, _scopeKey?: string): Promise<SyncResult> {
  return Promise.resolve(noopSync);
}

export async function syncAll(_token?: string, _me?: Me): Promise<SyncResult[]> {
  return [noopSync, noopSync, noopSync];
}

export async function getCachedCourses(branchId?: string): Promise<Course[]> {
  const courses = await invoke<Course[]>("list_courses");
  return branchId ? courses.filter((c) => c.branch_id === branchId) : courses;
}

export async function getCachedStudents(branchId?: string): Promise<Student[]> {
  const students = await invoke<Student[]>("list_students", {
    includeCancelled: false,
  });
  return branchId ? students.filter((s) => s.branch_id === branchId) : students;
}

export async function getCachedReceipts(
  studentId?: string,
  branchId?: string,
): Promise<CachedReceipt[]> {
  const receipts = await invoke<CachedReceipt[]>("list_receipts", {
    studentId: studentId ?? null,
  });
  return branchId
    ? receipts.filter((r) => r.branch_id === branchId)
    : receipts;
}

// Writes go directly to the DB through the create/update commands, so caching a
// returned record is a no-op now.
export function cacheStudent(_student: unknown): Promise<void> {
  return Promise.resolve();
}

export function cacheReceipt(_receipt: unknown): Promise<void> {
  return Promise.resolve();
}

export function getSyncStatus(): Promise<SyncStatus> {
  return Promise.resolve({
    courses: { last_synced: null, count: 0 },
    students: { last_synced: null, count: 0 },
    receipts: { last_synced: null, count: 0 },
  });
}

export function resetCache(): Promise<void> {
  return Promise.resolve();
}

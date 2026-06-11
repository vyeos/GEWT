import { invoke } from "@tauri-apps/api/core";
import type { Me } from "@/types";

export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

function toApiError(error: unknown): ApiRequestError {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "Request failed";
  // The backend returns "Not signed in" when there is no active session; map
  // that to 401 so the app falls back to the login screen.
  const status = /not signed in/i.test(message) ? 401 : 400;
  return new ApiRequestError(message, status);
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toApiError(error);
  }
}

// --- Typed helpers ---------------------------------------------------------

export function login(userId: string, password: string): Promise<Me> {
  return call<Me>("login", { userId, password });
}

export function logout(): Promise<void> {
  return call<void>("logout");
}

export function currentUser(): Promise<Me | null> {
  return call<Me | null>("current_user");
}

export function previewFormNo(branchId: string, date: string): Promise<string> {
  return call<string>("next_form_no", { branchId, date });
}

export function previewReceiptNo(branchId: string, date: string): Promise<string> {
  return call<string>("next_receipt_no", { branchId, date });
}

export function updateBranchCode(id: string, code: string) {
  return call("update_branch", { id, code });
}

export type ImportSummary = {
  branches: string[];
  students: number;
  receipts: number;
  courses: number;
};

export function exportBackup(branchIds: string[], destPath: string): Promise<void> {
  return call<void>("export_backup", { branchIds, destPath });
}

export function importBackup(srcPath: string): Promise<ImportSummary> {
  return call<ImportSummary>("import_backup", { srcPath });
}

export function createSnapshot(): Promise<{ path: string }> {
  return call<{ path: string }>("create_snapshot");
}

// --- Compatibility dispatcher ----------------------------------------------
//
// The feature components were written against a REST-style `api(path, token,
// init)` helper that talked to the old HTTP API. The app is now fully local and
// calls Rust directly via Tauri commands. To keep those components essentially
// unchanged, this dispatcher maps the old method+path combinations onto the new
// commands. The `token` argument is ignored (the session lives in Rust).

type Init = { method?: string; body?: string };

function parseBody(init: Init): Record<string, unknown> | undefined {
  if (!init.body) return undefined;
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export async function api<T>(
  path: string,
  _token: string | null,
  init: Init = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const [rawPath, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  const body = parseBody(init);

  // /auth/me
  if (rawPath === "/auth/me" && method === "GET") {
    const me = await currentUser();
    if (!me) throw new ApiRequestError("Not signed in", 401);
    return me as T;
  }

  if (rawPath === "/branches" && method === "GET") {
    return call<T>("list_branches");
  }

  if (rawPath === "/courses" && method === "GET") {
    return call<T>("list_courses");
  }
  if (rawPath === "/courses" && method === "POST") {
    return call<T>("create_course", { req: body });
  }
  const courseMatch = rawPath.match(/^\/courses\/(.+)$/);
  if (courseMatch && method === "PATCH") {
    return call<T>("update_course", { id: courseMatch[1], req: body });
  }

  if (rawPath === "/students" && method === "GET") {
    return call<T>("list_students", {
      includeCancelled: params.get("include_cancelled") === "true",
    });
  }
  if (rawPath === "/students" && method === "POST") {
    return call<T>("create_student", { req: body });
  }
  if (rawPath === "/students/promote" && method === "POST") {
    return call<T>("promote_students", { req: body });
  }
  const cancelMatch = rawPath.match(/^\/students\/(.+)\/cancel$/);
  if (cancelMatch && method === "POST") {
    return call<T>("cancel_student", { id: cancelMatch[1] });
  }
  const studentMatch = rawPath.match(/^\/students\/(.+)$/);
  if (studentMatch && method === "GET") {
    return call<T>("get_student", { id: studentMatch[1] });
  }
  if (studentMatch && method === "PATCH") {
    return call<T>("update_student", { id: studentMatch[1], req: body });
  }

  if (rawPath === "/receipts" && method === "GET") {
    const studentId = params.get("student_id");
    return call<T>("list_receipts", { studentId: studentId ?? null });
  }
  if (rawPath === "/receipts" && method === "POST") {
    return call<T>("create_receipt", { req: body });
  }

  if (rawPath === "/reports/outstanding" && method === "GET") {
    return call<T>("outstanding_report");
  }

  if (rawPath === "/users" && method === "GET") {
    return call<T>("list_users");
  }
  if (rawPath === "/users" && method === "POST") {
    return call<T>("create_user", { req: body });
  }
  const userMatch = rawPath.match(/^\/users\/(.+)$/);
  if (userMatch && method === "PATCH") {
    return call<T>("update_user", { id: userMatch[1], req: body });
  }

  if (rawPath === "/academic-settings" && method === "PATCH") {
    return call<T>("update_settings", { req: body });
  }

  throw new ApiRequestError(`Unsupported request: ${method} ${rawPath}`, 400);
}

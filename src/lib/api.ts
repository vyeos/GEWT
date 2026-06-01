import { invoke } from "@tauri-apps/api/core";

const DEFAULT_API_BASE = "http://localhost:45123";
const BUILD_API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;

let apiBase = BUILD_API_BASE || DEFAULT_API_BASE;
let runtimeApiBaseLoaded = Boolean(BUILD_API_BASE);

export function setApiBase(nextApiBase: string) {
  apiBase = nextApiBase;
  runtimeApiBaseLoaded = true;
}

export async function getApiBase() {
  if (BUILD_API_BASE) {
    return BUILD_API_BASE;
  }
  if (runtimeApiBaseLoaded) {
    return apiBase;
  }

  try {
    apiBase = await invoke<string>("get_api_base");
  } catch {
    apiBase = apiBase || DEFAULT_API_BASE;
  }
  runtimeApiBaseLoaded = true;

  return apiBase;
}

export async function api<T>(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${await getApiBase()}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export const API_BASE =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:45123";

export async function api<T>(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

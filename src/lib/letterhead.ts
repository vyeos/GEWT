import type { Course } from "@/types";

// Placeholder used when a course has no letterhead mapped, or its mapped file
// fails to load. Receipt/admission <img> tags also fall back to this onError.
export const LETTERHEAD_FALLBACK = "/logo.png";

/**
 * Resolve the printable letterhead URL for a course. Letterhead images live in
 * public/letterheads/ and are served at /letterheads/<filename>. Courses store
 * just the filename (e.g. "bca.png"); an unmapped course falls back to the logo.
 */
export function letterheadSrc(
  letterhead: Course["letterhead"] | undefined,
): string {
  return letterhead ? `/letterheads/${letterhead}` : LETTERHEAD_FALLBACK;
}

/**
 * Fetch the list of available letterhead filenames. The list is generated at
 * build/dev time by the letterhead-manifest Vite plugin (see vite.config.ts).
 * Returns an empty list if the manifest is missing.
 */
export async function fetchLetterheads(): Promise<string[]> {
  try {
    const response = await fetch("/letterheads/manifest.json", {
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as unknown;
    return Array.isArray(data)
      ? data.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string; body: string | undefined }
  | { state: "downloading"; progress: number }
  | { state: "ready" }
  | { state: "up-to-date" }
  | { state: "error"; message: string };

export async function checkForUpdate(): Promise<{
  available: boolean;
  version?: string;
  body?: string;
  update?: Awaited<ReturnType<typeof check>>;
}> {
  const update = await check();

  if (!update) {
    return { available: false };
  }

  return {
    available: true,
    version: update.version,
    body: update.body ?? undefined,
    update,
  };
}

export async function downloadUpdate(
  update: NonNullable<Awaited<ReturnType<typeof check>>>,
  onProgress?: (progress: number) => void,
) {
  let totalLength = 0;
  let downloaded = 0;

  await update.download((event) => {
    if (event.event === "Started" && event.data.contentLength) {
      totalLength = event.data.contentLength;
      return;
    }

    if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      if (totalLength > 0) {
        onProgress?.(Math.round((downloaded / totalLength) * 100));
      }
    }
  });
}

export async function installAndRelaunch(
  update: NonNullable<Awaited<ReturnType<typeof check>>>,
) {
  await update.install();
  await relaunch();
}

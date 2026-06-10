import { invoke } from "@tauri-apps/api/core";

function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform || navigator.userAgent;
  return /Mac/i.test(platform);
}

/**
 * Open the OS print dialog for the current page.
 *
 * macOS WKWebView silently ignores JavaScript `window.print()`, so there we go
 * through the native `print_page` Tauri command (which drives the WKWebView
 * print operation). Windows (WebView2) and Linux (WebKitGTK) honour
 * `window.print()`, and so does a plain browser during dev, so they use it.
 */
export async function printPage(): Promise<void> {
  if (isMacOS()) {
    try {
      await invoke("print_page");
      return;
    } catch {
      // Not running under Tauri (e.g. browser dev) — fall back to the browser's
      // own print, which works fine outside WKWebView.
    }
  }
  window.print();
}

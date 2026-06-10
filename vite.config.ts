import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const LETTERHEAD_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".svg"];

// Letterheads are <img>/print backgrounds, so they must be raster images. The
// office scanner produces single-page PDFs, so rasterize each PDF to a sibling
// PNG (macOS Quick Look gives ~140 DPI; sips is the fallback). The PNG is cached
// and only regenerated when the source PDF is newer. Returns false if no macOS
// rasterizer is available (e.g. CI on Linux) so the PDF is simply skipped.
function rasterizePdf(pdfPath: string, outPng: string): boolean {
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "letterhead-"));
    try {
      execFileSync("qlmanage", ["-t", "-s", "2000", "-o", tmp, pdfPath], {
        stdio: "ignore",
      });
      const produced = path.join(tmp, `${path.basename(pdfPath)}.png`);
      if (fs.existsSync(produced)) {
        fs.copyFileSync(produced, outPng);
        return true;
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } catch {
    // Quick Look unavailable — fall through to sips.
  }
  try {
    execFileSync("sips", ["-s", "format", "png", pdfPath, "--out", outPng], {
      stdio: "ignore",
    });
    return fs.existsSync(outPng);
  } catch {
    return false;
  }
}

// Public files are embedded into the packaged app, so the running webview can't
// enumerate them via the filesystem. We scan public/letterheads at build/dev
// time and write a manifest the frontend can fetch from /letterheads/manifest.json.
//
// Source PDFs (straight from the scanner) live in public/letterheads/pdf/ and are
// rasterized to a same-named PNG in public/letterheads/ (the served, listed copy).
// You can also drop ready-made images directly in public/letterheads/.
function letterheadManifest(): Plugin {
  const dir = path.resolve(__dirname, "public/letterheads");
  const pdfDir = path.join(dir, "pdf");
  const writeManifest = () => {
    if (!fs.existsSync(dir)) {
      // Folder may not exist yet — emit an empty manifest so the fetch succeeds.
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "manifest.json"), "[]\n");
      return;
    }

    // Rasterize each PDF in pdf/ to a cached PNG in the parent letterheads dir.
    if (fs.existsSync(pdfDir)) {
      for (const name of fs.readdirSync(pdfDir)) {
        if (path.extname(name).toLowerCase() !== ".pdf") continue;
        const pdfPath = path.join(pdfDir, name);
        const pngPath = path.join(dir, `${path.basename(name, ".pdf")}.png`);
        const upToDate =
          fs.existsSync(pngPath) &&
          fs.statSync(pngPath).mtimeMs >= fs.statSync(pdfPath).mtimeMs;
        if (!upToDate) rasterizePdf(pdfPath, pngPath);
      }
    }

    const files = fs
      .readdirSync(dir)
      .filter((name) =>
        LETTERHEAD_EXTENSIONS.includes(path.extname(name).toLowerCase()),
      )
      .sort((a, b) => a.localeCompare(b));
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify(files, null, 2),
    );
  };
  let outDir = "dist";
  return {
    name: "letterhead-manifest",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    buildStart() {
      writeManifest();
    },
    // The source PDFs are only inputs to rasterization — don't ship them in the
    // packaged app (Vite copies all of public/ into the bundle by default).
    writeBundle() {
      fs.rmSync(path.resolve(__dirname, outDir, "letterheads/pdf"), {
        recursive: true,
        force: true,
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), letterheadManifest()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

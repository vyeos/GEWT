#!/usr/bin/env node
// Bump the app version in package.json, src-tauri/Cargo.toml and
// src-tauri/tauri.conf.json, then sync src-tauri/Cargo.lock.
//
// Usage:
//   bun run bump patch        # 0.4.3 -> 0.4.4
//   bun run bump minor        # 0.4.3 -> 0.5.0
//   bun run bump major        # 0.4.3 -> 1.0.0
//   bun run bump 1.2.3        # explicit version

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const cargoPath = join(root, "src-tauri", "Cargo.toml");
const confPath = join(root, "src-tauri", "tauri.conf.json");

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: bun run bump <patch|minor|major|x.y.z>");
  process.exit(1);
}

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [maj, min, pat] = current.split(".").map(Number);
  if (bump === "major") return `${maj + 1}.0.0`;
  if (bump === "minor") return `${maj}.${min + 1}.0`;
  if (bump === "patch") return `${maj}.${min}.${pat + 1}`;
  console.error(`Invalid bump "${bump}" — use patch, minor, major or x.y.z`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;
const next = nextVersion(current, arg);

// package.json (preserve 2-space indent + trailing newline)
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// tauri.conf.json
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = next;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

// Cargo.toml — only the [package] version (the line that starts with `version =`)
const cargo = readFileSync(cargoPath, "utf8");
writeFileSync(cargoPath, cargo.replace(/^version = ".*"$/m, `version = "${next}"`));

// Cargo.lock — update just this crate's entry, no full build
execSync("cargo update -p gewt", {
  cwd: join(root, "src-tauri"),
  stdio: "inherit",
});

console.log(`\nBumped ${current} -> ${next}`);

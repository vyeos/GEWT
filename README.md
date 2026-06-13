# GEWT Fee Management

A desktop fee-management application for an academic trust/institute, built with
Tauri 2 (Rust) and React. It is **fully local**: a single SQLite database owned
by the Rust side of the app, with no server and no network dependency. Machines
exchange data through branch-partitioned `.gewtbak` backup files ("sneakernet"),
and can optionally share one database over a LAN folder.

See [agents.md](agents.md) for the full architecture, domain rules, and
engineering conventions.

## Stack

- Desktop shell: Tauri 2 (`src-tauri/`)
- Frontend: Vite, React 19, TypeScript, Tailwind CSS 4, shadcn/Radix UI
- Data layer: local SQLite owned by Rust (`src-tauri/src/db.rs`) — no server
- Package manager: Bun

The frontend talks to Rust through Tauri commands (`invoke`). `src/lib/api.ts`
maps the old REST-style paths onto those commands; there is no HTTP API.

## Develop

```bash
bun install
bun run dev          # frontend only (most flows need the Tauri backend)
bun run tauri dev    # the real desktop app
```

The seeded admin login is user ID `admin`, password `admin123`. It exists only
for first launch and is meant to be rotated by the admin afterwards.

## Build

```bash
bun run build        # tsc + vite build
bun run tauri build  # packaged desktop app
```

## Checks

```bash
bun run build                  # or: bunx tsc --noEmit
bun run test                   # frontend unit/component tests (vitest)
cd src-tauri && cargo test     # db/backup/fee smoke tests
cd src-tauri && cargo check
```

## Distribution

Packaged apps are built and published as GitHub releases by the CI workflow on
push to `master`. The installed app auto-installs updates at startup (time
capped) and also downloads them in the background, using GitHub release
metadata.

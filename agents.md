# Agent Guide for GEWT

This file is the working contract for AI/code agents in this repository. Read it
before making changes. The goal is to preserve the product thinking, domain
rules, and engineering style of this codebase so every agent starts from the
same mental model.

## Project Identity

GEWT is a desktop fee-management application for an academic trust/institute.
It is not a generic SaaS app. Optimize for clerical accuracy, predictable
workflows, low surprise, and clear branch-level access control.

The stack is:

- Desktop shell: Tauri 2 in `src-tauri/`
- Frontend: Vite, React 19, TypeScript, Tailwind CSS 4, shadcn/Radix UI,
  lucide-react icons, sonner toasts
- Data layer: fully local SQLite, owned by the Rust side of the Tauri app
  (`src-tauri/src/db.rs`). There is no server and no network dependency.
- Package manager: Bun

The frontend talks to Rust through Tauri commands (`invoke`). The
`api(path, token, init)` helper in `src/lib/api.ts` is a compatibility
dispatcher that maps the old REST-style paths onto those commands; the `token`
argument is ignored (the session lives in Rust memory).

Machines exchange data via "sneakernet" backup files (`.gewtbak`, plain JSON).
Import is branch-partitioned: each branch in the file replaces that branch's
local data; other branches are untouched. Admin imports also apply accounts and
academic settings (newest-wins); employee (branch-restricted) imports apply
business data only.

## First Rule: Protect Concurrent Work

Another agent or the user may be changing files at the same time.

- Do not revert, reset, or overwrite unrelated local changes.
- Check the worktree before editing if the task involves existing files.
- Treat modified files you did not touch as user/agent work in progress.
- If a file you need is already modified, read it carefully and make the
  smallest compatible change.
- Never use destructive git commands such as `git reset --hard` or
  `git checkout -- <file>` unless the user explicitly asks for that exact
  operation.
- Do not "clean up" package metadata, lockfiles, config, icons, or generated
  files unless the current task requires it.

## Repository Map

- `src/App.tsx`: top-level client state, theme, screen selection, data refresh.
- `src/features/admission/Admission.tsx`: student admission form and form number
  handling.
- `src/features/receipt/Receipt.tsx`: fee receipt workflow, current fee status,
  optimistic receipt updates.
- `src/features/outstanding/Outstanding.tsx`: outstanding fee report by course
  and admission year.
- `src/features/students/Students.tsx`: admin-only student review/edit, cancel
  admission, admission form reprint.
- `src/features/promote/Promote.tsx`: batch promotion to the next
  semester/term.
- `src/features/backup/Backup.tsx`: backup export/import and local snapshots
  (create, list, restore).
- `src/features/utility/Utility.tsx`: admin-only course, user, branch-code, and
  academic setting management.
- `src/components/app/`: app-specific layout components (AppShell).
- `src/components/ui/`: shadcn/Radix UI primitives. Keep these generic.
- `src/components/print/PrintPage.tsx`: A4 letterhead print page wrapper.
- `src/lib/api.ts`: Tauri command wrappers and the REST-path compatibility
  dispatcher.
- `src/lib/course-duration.ts`: course duration, billing period, and current
  course year rules.
- `src/lib/format.ts`: local date, INR money, and amount-in-words formatting.
- `src/lib/letterhead.ts` + `vite.config.ts`: letterhead manifest and
  PDF-to-PNG rasterization (letterheads are bundled from `public/letterheads/`
  at build time).
- `src/types.ts`: frontend domain types (must match the Rust structs in
  `src-tauri/src/db.rs`).
- `src-tauri/src/lib.rs`: Tauri setup, session state, command handlers, auth
  gates, updater, native macOS printing, smoke tests.
- `src-tauri/src/db.rs`: SQLite schema, migrations, seeds, and all business
  rules/SQL.
- `src-tauri/src/backup.rs`: `.gewtbak` export/import and local snapshot
  create/list/restore.
- `public/logo.png` and `src-tauri/icons/`: app branding assets.

## Local Commands

Use the existing scripts and tools:

```bash
bun install
bun run dev            # frontend only (most flows need the Tauri backend)
bun run build          # tsc + vite build
bun run tauri dev      # the real app
cd src-tauri && cargo check
cd src-tauri && cargo test   # runs the db/backup smoke tests
```

The seeded admin login is user ID `admin`, password `admin123`. It exists only
for first launch; the admin is expected to rotate it. Never pre-fill or print
these credentials in the UI.

## Product Rules

Respect these business constraints unless the user explicitly changes them.

- Roles are `admin` and `employee`.
- Admins can see and manage all branches.
- Employees must have a `branch_id` and can only access their assigned branch.
- Branches are seeded as `Prantij`, `HMT`, and `Talod` with STABLE ids
  (`11111111-…`, `22222222-…`, `33333333-…`) so backup imports align across
  machines. The default admin id is stable too. Do not change these ids.
- Courses belong to a branch and have `duration` plus `duration_type` of
  `year` or `semester`. Semester durations must be even. A course with
  admitted students cannot move to another branch.
- Admissions create students with a form number, branch, course, name parts
  (surname / student name / father's name, also stored combined in
  `student_name`), demographic/contact fields, and up to four yearly fee
  fields (only the years the course runs are billed).
- Students can never move between branches after admission.
- Document numbers follow `{branch-code}-{type-code}-{seq}-{academic-year}`
  with a per-branch, per-academic-year sequence. They are composed ONCE at
  creation and stored (`students.form_no`, `receipts.receipt_no`); renaming a
  branch code or type code only affects future documents. Form and receipt
  numbers are never editable.
- Receipts have a student, date, fee type, payment mode, amount, and optional
  reference/remarks.
- Payment modes are `Cash`, `UPI`, `DD`, `Cheque`, `NEFT`, and `RTGS`.
- Non-cash payment modes require a reference/remarks value.
- Fee types are `Tuition` and `Other`. Overpayment beyond the pending amount
  for a fee type is rejected in the backend, not just clamped in the UI.
- Dues accrue per period (half the yearly fee per semester/term) up to the
  student's current period. The academic year start month comes from settings
  (default September, `9`).
- Cancelling an admission zeroes the student's fees and hides them from
  receipts, promotion, and outstanding.
- Outstanding reports show only students with a pending balance.

When adding or changing business behavior, update both sides in the same
change:

- Frontend types and UI validation in `src/`
- Backend request structs, validation, and SQL in `src-tauri/src/db.rs`

## Backend and Database Rules

- Keep branch authorization in the Rust command layer
  (`require_session`, `require_admin`, `ensure_branch`, `branch_filter` in
  `src-tauri/src/lib.rs`). UI filtering is useful, but not a security boundary.
- Return plain, actionable error strings; map raw SQLite constraint errors to
  friendly text (see `friendly_db_error`).
- Use sqlx parameter binding. Do not build SQL with user input embedded in
  strings.
- Schema changes: extend `create_schema` for fresh databases AND add an
  idempotent `ALTER TABLE` in `migrate_schema` for existing ones. There are no
  numbered migration files anymore.
- Backup format changes: give new fields `#[serde(default)]` in
  `src-tauri/src/backup.rs` so older `.gewtbak` files still import, and
  backfill after import if needed. Bump `SCHEMA_VERSION` only for genuinely
  incompatible changes.
- Snapshot restore copies shared columns table-by-table so pre-migration
  snapshots stay restorable. Keep that property.
- Extend the smoke tests in `src-tauri/src/lib.rs` when touching numbering,
  backup, or fee logic, and run `cargo test`.

## Frontend Rules

- Keep TypeScript strict and avoid unused locals/parameters.
- Use `@/` imports for source files.
- Prefer existing shadcn/Radix primitives in `src/components/ui/`.
- Use lucide-react icons for icon buttons and navigation.
- Keep domain workflows in `src/features/<feature>/`.
- Use the helpers in `src/lib/api.ts` for backend calls.
- Show user-facing success/failure through sonner toasts; never let a save
  handler reject without a toast.
- Guard submit handlers against double-clicks (disable while saving).
- Use `today()` from `src/lib/format.ts` for default dates (local time, not
  UTC).
- Preserve the utilitarian desktop-app feel: clear forms, tables, filters, and
  compact workflows over marketing-style UI.
- Avoid introducing new global state libraries unless the app genuinely needs
  them.
- Maintain light/dark theme support through the `dark` class and existing CSS
  variables.
- Keep the UI branch-aware: admins may choose across branches, employees only
  see their branch.

## Styling Rules

- Tailwind CSS 4 is configured through `src/App.css` and the Vite Tailwind
  plugin.
- The component style is shadcn `radix-vega` with neutral base colors and CSS
  variables.
- Use the `cn()` helper from `src/lib/utils.ts` for conditional classes.
- Keep controls dense, legible, and stable in size.
- Tables should remain horizontally usable for desktop workflows.
- Avoid decorative redesigns unless the user specifically requests a visual
  redesign.

## Tauri Rules

- Tauri config lives in `src-tauri/tauri.conf.json`. A CSP is set for prod and
  dev (`devCsp`); if you add a new resource type, extend the CSP rather than
  removing it.
- The app identifier is `com.vyeos.gewt`.
- The dev URL is fixed at `http://localhost:1420`; Vite uses strict port 1420.
- The packaged app auto-installs updates at startup (time-capped) and also
  downloads them in the background from AppShell; updates come from GitHub
  release metadata.
- Printing on macOS goes through the native `print_page` command (WKWebView
  ignores `window.print()`); other platforms use `window.print()`.
- Local safety snapshots are taken on window close and at most daily on
  launch; the last 10 are kept in `app_data_dir/backups`.

## Testing and Verification

- Frontend or shared TypeScript changes: `bun run build` (or `bunx tsc --noEmit`)
- Rust changes: `cd src-tauri && cargo test` (smoke tests cover numbering,
  fees, backup roundtrips, and snapshot restore)
- End-to-end desktop behavior: `bun run tauri dev`

## Change Style

- Make narrow, direct changes that match the existing structure.
- Keep domain logic centralized when a helper already exists, especially course
  duration and money/date formatting.
- Do not introduce a dependency without a clear reason.
- If a backend contract changes, update `src/types.ts` and affected UI code in
  the same change.
- If a user-visible workflow changes, consider how an admin and an employee each
  experience it.
- Keep public copy simple and operational. Users are doing fee-office work, not
  exploring a brand site.

## Known Footguns

- `.gewtbak` files are plain JSON containing student PII and password hashes.
  Employee imports intentionally skip accounts/settings; do not "fix" that.
- Frontend pending-fee calculations (Receipt.tsx) and backend outstanding
  calculations (db.rs) must stay conceptually aligned.
- Document numbers are frozen at creation; never recompute them for existing
  rows except through `backfill_document_numbers` (which only fills empties).
- Employees must never gain cross-branch data access through a frontend-only
  filter mistake.
- Letterheads are bundled at build time; end users cannot add them at runtime.

## Definition of Done

Before handing work back:

- Relevant commands have been run, or the reason they were not run is stated.
- UI changes have been sanity-checked in the actual app when practical.
- Backend changes preserve auth and branch scoping.
- Schema changes work for both fresh and existing databases, and old backups
  still import.
- No unrelated local changes were reverted or reformatted.
- The final response summarizes what changed and calls out any remaining risk.

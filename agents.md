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
- API: Rust Axum service in `api/`
- Database: PostgreSQL via sqlx migrations in `api/migrations/`
- Package manager: Bun

The packaged desktop app starts the Rust API inside Tauri. During development
the frontend talks to `VITE_API_BASE_URL` or defaults to
`http://localhost:45123` for production.

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

- `src/App.tsx`: top-level client state, auth token, theme, screen selection,
  data refresh.
- `src/features/admission/Admission.tsx`: student admission form and form number
  handling.
- `src/features/receipt/Receipt.tsx`: fee receipt workflow, current fee status,
  optimistic receipt updates.
- `src/features/outstanding/Outstanding.tsx`: outstanding fee report by batch
  year and branch.
- `src/features/utility/Utility.tsx`: admin-only course, user, and academic
  setting management.
- `src/components/app/`: app-specific layout and reusable small components.
- `src/components/ui/`: shadcn/Radix UI primitives. Keep these generic.
- `src/lib/api.ts`: typed fetch wrapper and API base URL.
- `src/lib/course-duration.ts`: course duration, billing period, and current
  course year rules.
- `src/lib/format.ts`: date and INR money formatting.
- `src/types.ts`: frontend API/domain types.
- `api/src/lib.rs`: Axum routes, auth, business rules, SQL access.
- `api/migrations/`: PostgreSQL schema migrations and seed data.
- `src-tauri/src/lib.rs`: Tauri app setup and embedded API startup.
- `public/logo.png` and `src-tauri/icons/`: app branding assets.

## Local Commands

Use the existing scripts and tools:

```bash
bun install
bun run dev
bun run build
cd api && cargo run
cd api && cargo check
cd src-tauri && cargo check
bun run tauri dev
```

API development requires:

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/gewt
export JWT_SECRET=replace-me
export API_ADDR=127.0.0.1:45123
cd api && cargo run
```

The API runs migrations on startup. The seeded admin login is:

```text
user ID: admin
password: admin123
```

Do not assume these credentials are acceptable for production. The README
already says to rotate the seeded password and `JWT_SECRET`.

## Product Rules

Respect these business constraints unless the user explicitly changes them.

- Roles are `admin` and `employee`.
- Admins can see and manage all branches.
- Employees must have a `branch_id` and can only access their assigned branch.
- Branches are seeded as `Prantij`, `HMT`, and `Talod`.
- Courses belong to a branch and have `duration` plus `duration_type` of
  `year` or `semester`.
- Admissions create students with a form number, branch, course, full student
  name, demographic/contact fields, and up to four yearly fee fields.
- The admission UI composes student full name from surname, student name, and
  father's name before sending it to the API.
- Receipts have a numeric receipt number, student, date, fee type, payment mode,
  amount, and optional reference/remarks.
- Payment modes are `Cash`, `UPI`, `DD`, `Cheque`, `NEFT`, and `RTGS`.
- Non-cash payment modes require a reference/remarks value.
- Fee types are currently `Tuition` and `Other`.
- Tuition due is calculated by academic year/semester, using the academic year
  start month from settings.
- The default academic year start month is September (`9`).
- Outstanding reports consider tuition receipts and show only students with
  pending tuition dues.

When adding or changing business behavior, update both sides if needed:

- Frontend types and UI validation in `src/`
- Backend request structs, validation, SQL, and migrations in `api/`

## API and Database Rules

- Keep branch authorization in the backend. UI filtering is useful, but not a
  security boundary.
- Use `claims`, `require_admin`, and `ensure_branch` patterns for protected
  handlers.
- Return plain, actionable error text through `ApiError` so frontend toasts stay
  understandable.
- Use sqlx parameter binding. Do not build SQL with user input embedded in
  strings.
- For schema changes, add a new timestamped migration in `api/migrations/`.
  Do not edit old migrations after they may have been applied.
- Keep migrations idempotent where practical with `IF EXISTS`, `IF NOT EXISTS`,
  or conflict handling.
- Remember that `api/src/lib.rs` is also compiled into the Tauri app through the
  `gewt-api` path dependency.
- Keep the embedded API config path behavior: packaged app reads `.env` from the
  app config directory, such as
  `~/Library/Application Support/com.vyeos.gewt/.env` on macOS.

Number generation details:

- Form numbers are currently based on the max numeric `students.form_no` + 1 and
  formatted with 4-digit padding.
- Receipt numbers are currently based on max `receipts.receipt_no` + 1.
- The old `numbering_rules` table has been dropped by migration. Do not
  reintroduce it casually.

## Frontend Rules

- Keep TypeScript strict and avoid unused locals/parameters.
- Use `@/` imports for source files.
- Prefer existing shadcn/Radix primitives in `src/components/ui/`.
- Use lucide-react icons for icon buttons and navigation.
- Keep app-specific reusable pieces in `src/components/app/`.
- Keep domain workflows in `src/features/<feature>/`.
- Use `api<T>()` from `src/lib/api.ts` for HTTP calls.
- Show user-facing success/failure through sonner toasts.
- Preserve the utilitarian desktop-app feel: clear forms, tables, filters, and
  compact workflows over marketing-style UI.
- Avoid introducing new global state libraries unless the app genuinely needs
  them.
- Maintain light/dark theme support through the `dark` class and existing CSS
  variables.
- Keep the UI branch-aware: admins may choose across branches, employees should
  only see their branch.
- Do not hard-code backend URLs outside `src/lib/api.ts`.

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

- Tauri config lives in `src-tauri/tauri.conf.json`.
- The app identifier is `com.vyeos.gewt`.
- The dev URL is fixed at `http://localhost:1420`; Vite uses strict port 1420.
- The packaged app bundles update support and points at GitHub release update
  metadata.
- `src-tauri/src/lib.rs` currently starts the embedded API during setup.
- There is still a template `greet` command. Do not rely on it for product
  behavior; remove or replace it only when the task calls for Tauri command
  cleanup.

## Testing and Verification

There is no dedicated automated test suite in the current repo. Use targeted
checks according to the files changed:

- Frontend or shared TypeScript changes: `bun run build`
- API changes: `cd api && cargo check`
- Tauri integration changes: `cd src-tauri && cargo check`
- End-to-end desktop behavior: run API plus `bun run dev`, or use
  `bun run tauri dev` when Tauri behavior matters.

For database changes, test against a PostgreSQL database with `DATABASE_URL`
set. Because migrations run on startup, a broken migration can block the API
from launching.

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

- Receipt and form number generation uses max-value queries, so concurrent submissions can still race at the unique constraint. Handle errors clearly if changing this area.
- Frontend pending-fee calculations and backend outstanding calculations should stay conceptually aligned.
- `Other` receipts are not part of outstanding tuition dues.
- Employees must never gain cross-branch data access through a frontend-only filter mistake.
- Old backup/dropdown/numbering tables were removed by migrations; avoid building new features against them.

## Definition of Done

Before handing work back:

- Relevant commands have been run, or the reason they were not run is stated.
- UI changes have been sanity-checked in the actual app when practical.
- Backend changes preserve auth and branch scoping.
- Migrations are additive/new files, not edits to historical migrations.
- No unrelated local changes were reverted or reformatted.
- The final response summarizes what changed and calls out any remaining risk.

# GEWT Fee Management

GEWT is a desktop fee-management application for an academic
trust/institute. It is built for fee-office clerical work: admitting students,
issuing receipts, tracking pending balances, promoting students through their
course periods, printing official documents on bundled letterheads, and moving
data between branch machines without a server.

This README is intentionally detailed so a future agent/thread can understand
the app without first spelunking through the entire codebase. For the stricter
agent working contract, also read [agents.md](agents.md).

## Product Mental Model

GEWT is not a generic SaaS dashboard. It is a local desktop application used by
clerks/admins at an academic trust. The important product qualities are:

- Clerical accuracy over visual flourish.
- Predictable forms, tables, filters, and print workflows.
- Strong branch-level access control.
- Stable document numbers that never change after issue.
- Local-first operation with no required server or network dependency.
- Backup/import flows that work across machines by physically moving `.gewtbak`
  files.

There are two roles:

- `admin`: can see and manage all branches, users, courses, branch codes,
  academic settings, imports, snapshots, and cancellations.
- `employee`: must have a `branch_id`; can only work in that assigned branch
  and only on pages enabled by per-page permission flags.

Seeded branches use stable IDs so imports align across machines:

- Prantij: `11111111-1111-1111-1111-111111111111`
- HMT: `22222222-2222-2222-2222-222222222222`
- Talod: `33333333-3333-3333-3333-333333333333`

The seeded admin login is user ID `irrn`, password `Ripal@1305`. It exists only
for first launch and is expected to be rotated by the admin. Do not prefill or
display those credentials in the UI.

## Stack

- Desktop shell: Tauri 2 in `src-tauri/`
- Backend/runtime: Rust, SQLite, sqlx
- Frontend: Vite, React 19, TypeScript, Tailwind CSS 4
- UI: shadcn/Radix primitives, lucide-react icons, sonner toasts
- Package manager: Bun
- Data storage: local SQLite database owned by Rust

There is no HTTP server. The frontend calls Rust Tauri commands through
`invoke`. The helper in `src/lib/api.ts` keeps compatibility with older
REST-style frontend calls by mapping paths like `/students` or `/receipts` to
Tauri commands. The `token` argument in that helper is ignored because session
state lives in Rust memory.

## What The App Can Do

### Login And Session

Users sign in through the local SQLite user table. The Rust side keeps the
current session in memory only. Closing/relaunching the app requires a new
login. `current_user` reloads the signed-in identity and academic settings for
the frontend.

Important files:

- `src/features/login/Login.tsx`
- `src-tauri/src/lib.rs`
- `src-tauri/src/db.rs`

### Admission

The admission workflow creates a student record with:

- Generated form number.
- Admission date.
- Branch and course.
- Name parts: surname, student name, father's name.
- Combined `student_name` for display/search.
- Category, religion, caste, gender.
- Aadhar, address, district, taluka, pincode.
- Student and parent phone.
- Optional photo.
- Yearly fee fields for up to four years.
- Tuition/other fee split per year.

Only the years the selected course actually runs are billed. For example, a
one-year course fills only year 1; later fee years are zero.

The app prints an admission form on the selected course letterhead immediately
after saving.

Important files:

- `src/features/admission/Admission.tsx`
- `src/features/admission/AdmissionPrint.tsx`
- `src/components/print/PrintPage.tsx`
- `src-tauri/src/db.rs`

### Courses

Courses belong to a branch. A course has:

- `branch_id`
- `name`
- `duration`
- `duration_type`: `year` or `semester`
- optional `letterhead`
- `active`

Rules:

- Semester durations must be even.
- The fee model supports at most 4 years or 8 semesters.
- A course with admitted students cannot move to another branch.
- Courses with students cannot be deleted; they can be archived.
- Archived courses disappear from active pickers, but existing students remain
  loadable and promotable.

Important files:

- `src/features/utility/Utility.tsx`
- `src/lib/course-duration.ts`
- `src-tauri/src/db.rs`

### Fee Receipts

The receipt workflow lets a user select a student, view current fee status, and
record a payment. Receipts include:

- Generated receipt number.
- Receipt date.
- Student.
- Branch.
- Fee type: `Tuition` or `Other`.
- Payment mode: `Cash`, `UPI`, `DD`, `Cheque`, `NEFT`, `RTGS`.
- Amount paid.
- Optional reference/remarks.

Rules:

- Non-cash payment modes require a non-blank reference/remarks value.
- Amounts must be whole rupees.
- Amounts must be positive.
- Overpayment beyond pending amount for that fee type is rejected in Rust, not
  only clamped in the UI.
- A receipt branch must match the student's branch.
- Cancelled admissions cannot receive new receipts.
- Receipts can be cancelled/voided by admin; cancelled receipts keep their
  number but stop counting toward paid totals.

The frontend shows optimistic receipt updates and then replaces them with the
saved backend response. Receipt printing uses the student's actual course
letterhead.

Important files:

- `src/features/receipt/Receipt.tsx`
- `src/features/receipt/ReceiptPrint.tsx`
- `src-tauri/src/db.rs`

### Outstanding Report

Outstanding reports show only active students with a pending balance. Dues
accrue by billing period up to each student's current period:

- Year courses are billed as two terms per year.
- Semester courses are billed as semesters.
- Each period is half of that course year's fee.
- Tuition and Other fee balances are tracked independently.
- Payments allocate oldest due periods first.

The report includes per-year breakdowns, total due, total paid, pending, current
period label, and last non-cancelled receipt number.

Important files:

- `src/features/outstanding/Outstanding.tsx`
- `src/features/outstanding/OutstandingPrint.tsx`
- `src-tauri/src/db.rs`

### Student Review And Cancellation

The Students page is for admin review/edit. It supports:

- Listing students, including cancelled admissions for admin review.
- Editing allowed student details and current fees.
- Reprinting admission forms.
- Cancelling admissions.

Rules:

- Students can never move branches after admission.
- A student may stay enrolled in an archived course, but cannot be moved onto a
  different archived course.
- Cancelling admission zeroes all fee fields.
- Cancelled students are hidden from receipts, promotion, and outstanding.
- Passed-year fees are locked. Once a student has moved beyond a course year,
  that completed year's fee values cannot be changed.

Important files:

- `src/features/students/Students.tsx`
- `src-tauri/src/db.rs`

### Promotion

Promotion moves selected students to the next course period. It is batch-based:

- Choose course.
- Choose admission year.
- Select students.
- Promote them to the next term/semester.

Rules:

- Duplicate selected IDs are de-duplicated.
- Students at the final period are skipped.
- Cancelled students are not promotable.
- Selected students must match the chosen course and admission year.
- Archived courses remain promotable for existing students.

Important files:

- `src/features/promote/Promote.tsx`
- `src/lib/course-duration.ts`
- `src-tauri/src/db.rs`

### Utility/Admin Management

Admins manage:

- Courses.
- Users.
- Branch codes.
- Academic settings.

User rules:

- Employees require a branch.
- Admins have no branch.
- The last active admin cannot be demoted or deactivated.
- Employee page permissions are enforced in Rust command handlers; frontend
  hiding is not the security boundary.

Academic settings:

- `academic_year_start_month` defaults to September (`9`).
- It affects admission form academic-year numbering.
- Valid values are 1 through 12.

Important files:

- `src/features/utility/Utility.tsx`
- `src/lib/access.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/db.rs`

### Backups, Imports, And Snapshots

Data exchange is intentionally simple: `.gewtbak` files are plain JSON and can
be moved between machines manually. Treat them as sensitive because they contain
student PII and password hashes.

Backup behavior:

- Export is branch-scoped.
- Admin exports include all admins plus employees of exported branches.
- Employee exports include only employees of that branch, not admin accounts.
- Import is branch-partitioned: each branch in the file replaces that branch's
  local business data; other branches are left untouched.
- Admin imports also apply branch config, academic settings, and accounts using
  newest-wins semantics.
- Employee/restricted imports apply business data only. They intentionally skip
  accounts and settings.
- Import validates that all business rows belong to declared branches and that
  courses, students, receipts, and sequences do not cross-link branches.

Local safety snapshots:

- Stored under `app_data_dir/backups`.
- Created on app close in local mode.
- Created at most daily on launch in local mode.
- Manual create/list/restore is available from the backup UI.
- Snapshot restore is admin-only and replaces the full database.
- Restore copies shared columns table by table so older snapshots can still
  restore after schema changes.

Important files:

- `src/features/backup/Backup.tsx`
- `src-tauri/src/backup.rs`
- `src-tauri/src/db.rs`

### LAN Mode

The app normally uses a per-machine local database. It can optionally point at a
shared database folder for LAN usage.

Rules:

- Local mode uses SQLite WAL.
- LAN mode uses a rollback journal and busy timeout, because WAL is unsafe
  across hosts.
- If the configured LAN folder is unreachable at startup, the app surfaces a
  boot error rather than silently falling back to local data.
- Automatic raw-copy snapshots are skipped in LAN mode because another machine
  may be writing the database.
- The frontend can poll SQLite `data_version` in LAN mode to detect external
  writes.

Important files:

- `src-tauri/src/lan.rs`
- `src-tauri/src/lib.rs`
- `src/features/boot/BootError.tsx`
- `src/App.tsx`

### Printing And Letterheads

Printed admission, receipt, and outstanding documents render through React
print components and an A4 print wrapper.

Rules:

- Letterheads are bundled at build time from `public/letterheads/`.
- End users cannot add letterheads at runtime.
- macOS printing uses the native Rust `print_page` command because WKWebView
  ignores `window.print()`.
- Other platforms use `window.print()`.
- The print flow waits for letterhead images before opening the print dialog.

Important files:

- `src/components/print/PrintPage.tsx`
- `src/features/admission/AdmissionPrint.tsx`
- `src/features/receipt/ReceiptPrint.tsx`
- `src/features/outstanding/OutstandingPrint.tsx`
- `src/lib/letterhead.ts`
- `src/lib/print.ts`
- `vite.config.ts`
- `public/letterheads/`

### Updates And Distribution

Packaged apps are built and published as GitHub releases by CI on push to
`master`. The installed app checks GitHub release metadata and auto-installs
updates at startup with a time cap. AppShell also downloads updates in the
background after startup.

Important files:

- `src/lib/updater.ts`
- `src/components/app/AppShell.tsx`
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`

## Document Numbering

Document numbers are composed once at creation and stored permanently:

- Admission form numbers: `{branch-code}-{seq}-{academic-year}`
- Receipt numbers: `{branch-code}-{seq}`

Examples:

- First Prantij form in academic year 2026: `PRJ-1-2026`
- First Prantij receipt: `PRJ-1`

Important rules:

- Form sequences are per branch and academic year.
- Receipt sequences are branch-wide and yearless in the visible receipt number.
- Renaming a branch code affects only future documents.
- Existing `students.form_no` and `receipts.receipt_no` must not be recomputed.
- `backfill_document_numbers` only fills empty legacy numbers.

## Course Period And Fee Model

The whole app assumes a maximum four-year fee model:

- `fee_year_1` through `fee_year_4`
- `tuition_fee_year_1` through `tuition_fee_year_4`
- `other_fee_year_1` through `other_fee_year_4`
- `current_course_period` is between 1 and 8

Year courses bill two terms per year. Semester courses bill one semester per
period. In both cases, each period is half of that year's fee.

Frontend helpers in `src/lib/course-duration.ts` and backend helpers in
`src-tauri/src/db.rs` must stay conceptually aligned.

## Architecture

### Frontend Flow

`src/App.tsx` owns top-level client state:

- Boot status.
- Signed-in user.
- Branches/courses/settings data refresh.
- Active screen.
- Theme.
- LAN polling refresh behavior.

Feature screens live under `src/features/<feature>/`. They call `api(...)` or
typed helpers from `src/lib/api.ts`, show success/failure through sonner toasts,
and keep forms/tables dense and operational.

### Backend Flow

`src-tauri/src/lib.rs` wires Tauri setup and commands. It owns:

- Session state.
- Auth gates.
- Branch filtering.
- Feature permission checks.
- LAN path setup.
- Snapshot command access.
- Native printing.
- Update startup behavior.
- Rust smoke tests.

`src-tauri/src/db.rs` owns:

- SQLite schema creation and migration.
- Seed data.
- Business validation.
- SQL queries and updates.
- Fee, numbering, promotion, outstanding logic.

`src-tauri/src/backup.rs` owns:

- `.gewtbak` export/import.
- Branch-partition replacement.
- Backup payload validation.
- Local safety snapshots.
- Snapshot restore.

## Repository Map

- `src/App.tsx`: top-level app state, refresh, boot flow, theme, screen routing.
- `src/features/login/Login.tsx`: login form.
- `src/features/admission/Admission.tsx`: admission form and form number
  preview.
- `src/features/admission/AdmissionPrint.tsx`: admission print document.
- `src/features/receipt/Receipt.tsx`: fee receipt workflow, fee status, cancel
  receipt, optimistic receipt update.
- `src/features/receipt/ReceiptPrint.tsx`: receipt print document.
- `src/features/outstanding/Outstanding.tsx`: outstanding report filters and
  data view.
- `src/features/outstanding/OutstandingPrint.tsx`: outstanding print document.
- `src/features/students/Students.tsx`: admin student review/edit/cancel.
- `src/features/promote/Promote.tsx`: batch promotion.
- `src/features/backup/Backup.tsx`: backup export/import and snapshots.
- `src/features/utility/Utility.tsx`: admin courses, users, branch codes,
  academic settings.
- `src/features/boot/BootError.tsx`: recovery UI when DB cannot open.
- `src/components/app/AppShell.tsx`: navigation, refresh, sign-out, update UI.
- `src/components/app/CourseGroups.tsx`: grouped course selection UI.
- `src/components/app/StudentPhotoField.tsx`: photo input.
- `src/components/ui/`: generic shadcn/Radix primitives.
- `src/components/print/PrintPage.tsx`: A4 print wrapper.
- `src/data/seeds.ts`: frontend static seeds such as payment modes.
- `src/lib/access.ts`: frontend role/page visibility helpers.
- `src/lib/api.ts`: Tauri command wrappers and REST-path compatibility layer.
- `src/lib/course-duration.ts`: frontend course duration and period helpers.
- `src/lib/format.ts`: local date, INR money, amount-in-words helpers.
- `src/lib/image.ts`: image utility helpers.
- `src/lib/letterhead.ts`: letterhead manifest helpers.
- `src/lib/print.ts`: platform-aware print wrapper.
- `src/lib/updater.ts`: frontend update integration.
- `src/lib/utils.ts`: shared `cn()` helper.
- `src/types.ts`: frontend domain types, kept aligned with Rust structs.
- `src-tauri/src/lib.rs`: Tauri setup, commands, auth/session, tests.
- `src-tauri/src/db.rs`: schema, migrations, seeds, SQL, business rules.
- `src-tauri/src/backup.rs`: backup/import/snapshot logic.
- `src-tauri/src/lan.rs`: LAN database path config.
- `src-tauri/tauri.conf.json`: Tauri app config and CSP.
- `public/letterheads/`: bundled letterhead images.
- `public/logo.png` and `src-tauri/icons/`: branding assets.

## Backend Authorization Rules

Keep authorization in Rust. Frontend filtering is helpful UX, not security.

Key command-layer helpers in `src-tauri/src/lib.rs`:

- `require_session`: user must be signed in.
- `require_admin`: user must be admin.
- `ensure_branch`: employee may only access their assigned branch.
- `branch_filter`: admin gets all branches; employee gets assigned branch.
- `ensure_feature`: employee page permission flags.
- `ensure_student_read_access`: students can be read by admin or employees
  with receipt/students/promote permission.

When adding a command:

- Require a session or admin explicitly.
- Apply employee feature permissions when relevant.
- Apply branch checks using real backend data, not only request payloads.
- Keep error strings plain and actionable.

## Database And Migration Rules

There are no numbered migration files. Schema evolution is handled in
`src-tauri/src/db.rs`:

- Update `create_schema` for fresh databases.
- Add idempotent migration logic in `migrate_schema` for existing databases.
- Use sqlx parameter binding.
- Do not build SQL by embedding user input in strings.
- Map SQLite constraints to friendly messages where clerks will see them.
- Keep Rust structs aligned with frontend types in `src/types.ts`.
- Add smoke tests when touching numbering, backup, fee logic, branch scoping,
  migrations, or snapshot behavior.

Backup format changes:

- Add `#[serde(default)]` for new fields in `src-tauri/src/backup.rs`.
- Backfill after import if needed.
- Bump `SCHEMA_VERSION` only for genuinely incompatible backup changes.

## Frontend Style And UX Rules

This is a utilitarian desktop app:

- Prefer clear forms, tables, filters, and stable controls.
- Keep workflows compact and predictable.
- Use existing shadcn/Radix primitives.
- Use lucide-react icons for navigation and icon buttons.
- Use `@/` imports.
- Keep TypeScript strict and avoid unused locals.
- Use `today()` from `src/lib/format.ts` for local default dates.
- Disable submit buttons while saving to prevent double-click duplicates.
- Every save/failure path should show a sonner toast.
- Maintain light/dark theme through CSS variables and the `dark` class.
- Keep branch-aware UI: admins may choose across branches; employees see only
  their branch.
- Avoid decorative redesigns unless specifically requested.

## Local Commands

Install dependencies:

```bash
bun install
```

Run frontend only:

```bash
bun run dev
```

Run the real desktop app:

```bash
bun run tauri dev
```

Build frontend:

```bash
bun run build
```

Build packaged app:

```bash
bun run tauri build
```

Run frontend tests:

```bash
bun run test
```

Run Rust tests:

```bash
cd src-tauri && cargo test
```

Rust check:

```bash
cd src-tauri && cargo check
```

## Test Coverage Map

### Frontend Tests

- `src/lib/api.test.ts`: verifies the compatibility dispatcher maps REST-style
  routes to Tauri command names and argument casing; verifies unsupported
  routes fail before invoking Rust.
- `src/lib/course-duration.test.ts`: verifies year/semester course period
  calculations, duration caps, current period/year derivation, and labels.
- `src/lib/format.test.ts`: verifies local-date `today()`, INR money formatting,
  and Indian numbering words.
- `src/lib/access.test.ts`: verifies frontend page access flags, admin access,
  backup/utility visibility, fallback screen selection, and permission labels.
- `src/components/app/AppShell.test.tsx`: verifies employee navigation hiding,
  admin utility visibility, refresh action, and sign-out confirmation.
- `src/features/login/Login.test.tsx`: verifies login submission, in-flight
  disabling, and failed login behavior.
- `src/features/receipt/ReceiptPrint.test.tsx`: verifies receipt print uses the
  receipt date instead of today's date.
- `src/test/elaborate-print-render.test.tsx`: renders admission, receipt, and
  outstanding print components from a payload. It is used by the ignored Rust
  artifact flow to save full document bundles.

### Rust Tests

Rust smoke tests live in `src-tauri/src/lib.rs` because they exercise the
private app modules directly.

- `backend_access_helpers_enforce_employee_scope_test`: backend employee branch
  and page-permission gates.
- `receipt_validation_and_fee_breakdown`: non-cash references, payment modes,
  reference trimming, fee-type overpayment, and outstanding clearance.
- `receipt_branch_must_match_student`: receipts cannot be recorded under a
  branch other than the student's branch.
- `student_fee_split_validation`: fee split totals, negative fee rejection, and
  valid tuition/other split persistence.
- `promotion_deduplicates_and_stops_at_course_end`: duplicate selected students
  and final-period skips.
- `academic_year_settings_affect_numbering`: academic-year start month,
  preview numbering, and invalid settings.
- `backup_import_rejects_cross_branch_payloads`: malformed backup payloads
  cannot smuggle cross-branch data or cross-link students to another branch's
  course.
- `cancelled_admission_is_hidden_and_zeroed`: cancellation zeroes fees and hides
  students from active/outstanding views.
- `course_branch_moves_respect_enrollment`: empty courses can move branches;
  courses with admitted students cannot.
- `outstanding_partial_payment_allocation`: oldest-period-first allocation
  across years and fee types.
- `course_duration_is_capped`: backend rejects courses beyond 4 years or 8
  semesters while accepting boundary values.
- `legacy_current_course_year_column_is_dropped`: migration removes old
  `current_course_year` without losing data.
- `local_db_smoke`: broad end-to-end database smoke covering seeds, numbering,
  overpayment, receipt cancellation, decimal rejection, malformed dates,
  archive/delete behavior, frozen document numbers, branch moves, snapshots,
  outstanding, branch-partitioned backup import, and account import behavior.
- `elaborate_fee_office_flow_with_saved_artifacts`: ignored by default; writes a
  full saved admission/receipt/outstanding artifact bundle to `~/Downloads`.

## Common Change Guidance

When changing business behavior:

- Update Rust validation/SQL and frontend validation/types in the same change.
- Keep branch authorization in Rust command handlers.
- Add or update Rust smoke tests for backend rules.
- Add frontend tests for UI helper/component behavior.
- Run `cargo test` for Rust changes.
- Run `bun run build` for TypeScript/frontend changes.
- Run `bun run test` when touching frontend logic or helpers.

When changing schema:

- Update fresh schema.
- Add idempotent migration.
- Preserve old snapshot restore.
- Preserve old backup import where possible.

When changing backup format:

- Treat `.gewtbak` as sensitive plain JSON.
- Keep employee imports business-data-only unless the product rule changes.
- Validate branch partition boundaries.
- Use serde defaults for new fields.

When changing receipt/outstanding logic:

- Keep frontend pending-fee calculations in `Receipt.tsx` aligned with backend
  calculations in `db.rs`.
- Backend remains authoritative for overpayment and cancelled receipt handling.

When changing print:

- Verify the real print components.
- Preserve letterhead loading before invoking print.
- Remember macOS uses the Rust `print_page` command.

## Known Footguns

- `.gewtbak` files are plain JSON with PII and password hashes.
- Employees must never gain cross-branch access through frontend-only filters.
- Document numbers are frozen at creation.
- Receipt numbers are currently branch-wide and yearless.
- Academic-year start month affects form numbering.
- Cancelled admissions zero fees and must stay out of receipt/promotion/
  outstanding workflows.
- Passed-year fees are locked; current-year fees remain editable.
- Letterheads are build-time assets.
- Vite dev URL is fixed at `http://localhost:1420`; Tauri expects that port.
- Tauri CSP is set in `src-tauri/tauri.conf.json`; extend it carefully rather
  than removing it.

## Definition Of Done

Before handing work back:

- Relevant tests/checks were run, or the reason they were not run is stated.
- Backend changes preserve auth and branch scoping.
- Schema changes work for fresh and existing databases.
- Backup changes preserve old import behavior where possible.
- UI changes were sanity-checked in the actual app when practical.
- No unrelated local changes were reverted or reformatted.
- The final response summarizes changed files, verification, and remaining
  risks.

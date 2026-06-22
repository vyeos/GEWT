//! Local SQLite data layer for GEWT.
//!
//! This module replaces the former axum + PostgreSQL API. The desktop app now
//! owns a single authoritative SQLite database in the app data directory and
//! talks to it directly (no server, no network). The logic here is ported from
//! the original `api/src/lib.rs` handlers, adapted to SQLite and to the new
//! per-branch numbering scheme (`{branch}-{seq}-{year}` for admission forms,
//! `{branch}-{seq}` for receipts).

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, SaltString},
    Argon2, PasswordVerifier,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;

pub type DbResult<T> = Result<T, String>;

/// The Argon2id hash of the default seeded admin password. Rotated by the admin
/// after first login.
const DEFAULT_ADMIN_HASH: &str =
    "$argon2id$v=19$m=19456,t=2,p=1$UkZBbFJHMXBOSklRb3IwZw$B1kKcIvdHObfeFc8sUBay0+IbZILpK6ZP0OmwgHiFfo";

pub fn db_file(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("gewt.db")
}

/// Normal local mode: the per-machine database in the app-data dir, opened in
/// WAL. Unchanged behaviour — used by the smoke tests and every machine that has
/// not opted into LAN mode.
pub async fn init_db(app_data_dir: &Path) -> DbResult<SqlitePool> {
    open_pool(&db_file(app_data_dir), false).await
}

/// Open (creating if missing) the SQLite database at `db_path` and bring its
/// schema up to date.
///
/// `lan` selects the journal mode. Normal local databases use **WAL**, which is
/// fast but relies on a shared-memory file that only works when every connection
/// is on the same host. A database shared across machines over a network folder
/// must therefore use a rollback journal (**TRUNCATE**) plus a `busy_timeout` so
/// a writer on one machine makes the others wait rather than fail outright.
pub async fn open_pool(db_path: &Path, lan: bool) -> DbResult<SqlitePool> {
    let mut opts =
        SqliteConnectOptions::from_str(&format!("sqlite:{}?mode=rwc", db_path.display()))
            .map_err(|e| e.to_string())?
            .foreign_keys(true);
    opts = if lan {
        // Shared over a network folder: rollback journal (WAL can't cross hosts)
        // and a generous busy_timeout so a peer's write makes us wait, not fail.
        opts.journal_mode(sqlx::sqlite::SqliteJournalMode::Truncate)
            .busy_timeout(std::time::Duration::from_secs(15))
    } else {
        // Normal local mode — unchanged.
        opts.journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
    };
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await
        .map_err(|e| e.to_string())?;
    create_schema(&pool).await?;
    migrate_schema(&pool).await?;
    seed_if_empty(&pool).await?;
    backfill_document_numbers(&pool).await?;
    Ok(pool)
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

async fn create_schema(pool: &SqlitePool) -> DbResult<()> {
    let statements = [
        "CREATE TABLE IF NOT EXISTS branches (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL UNIQUE,
            updated_at TEXT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('admin','employee')),
            branch_id TEXT REFERENCES branches(id),
            active INTEGER NOT NULL DEFAULT 1,
            can_admission INTEGER NOT NULL DEFAULT 1,
            can_receipt INTEGER NOT NULL DEFAULT 1,
            can_outstanding INTEGER NOT NULL DEFAULT 1,
            can_students INTEGER NOT NULL DEFAULT 1,
            can_promote INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL,
            CHECK (role = 'admin' OR branch_id IS NOT NULL)
        )",
        "CREATE TABLE IF NOT EXISTS courses (
            id TEXT PRIMARY KEY,
            branch_id TEXT NOT NULL REFERENCES branches(id),
            name TEXT NOT NULL,
            duration INTEGER NOT NULL CHECK (duration > 0),
            duration_type TEXT NOT NULL CHECK (duration_type IN ('year','semester')),
            letterhead TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL,
            UNIQUE (branch_id, name)
        )",
        "CREATE TABLE IF NOT EXISTS academic_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            academic_year_start_month INTEGER NOT NULL DEFAULT 9 CHECK (academic_year_start_month BETWEEN 1 AND 12),
            updated_at TEXT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS students (
            id TEXT PRIMARY KEY,
            form_seq INTEGER NOT NULL,
            form_year INTEGER NOT NULL,
            form_no TEXT NOT NULL DEFAULT '',
            admission_date TEXT NOT NULL,
            branch_id TEXT NOT NULL REFERENCES branches(id),
            course_id TEXT NOT NULL REFERENCES courses(id),
            student_name TEXT NOT NULL,
            surname TEXT NOT NULL DEFAULT '',
            father_name TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL,
            religion TEXT NOT NULL DEFAULT '',
            caste TEXT NOT NULL DEFAULT '',
            gender TEXT NOT NULL CHECK (gender IN ('Male','Female')),
            aadhar TEXT NOT NULL DEFAULT '',
            address TEXT NOT NULL DEFAULT '',
            district TEXT NOT NULL DEFAULT '',
            taluka TEXT NOT NULL DEFAULT '',
            pincode TEXT NOT NULL DEFAULT '',
            student_phone TEXT NOT NULL DEFAULT '',
            parent_phone TEXT NOT NULL DEFAULT '',
            photo TEXT NOT NULL DEFAULT '',
            fee_year_1 REAL NOT NULL DEFAULT 0,
            fee_year_2 REAL NOT NULL DEFAULT 0,
            fee_year_3 REAL NOT NULL DEFAULT 0,
            fee_year_4 REAL NOT NULL DEFAULT 0,
            tuition_fee_year_1 REAL NOT NULL DEFAULT 0,
            tuition_fee_year_2 REAL NOT NULL DEFAULT 0,
            tuition_fee_year_3 REAL NOT NULL DEFAULT 0,
            tuition_fee_year_4 REAL NOT NULL DEFAULT 0,
            other_fee_year_1 REAL NOT NULL DEFAULT 0,
            other_fee_year_2 REAL NOT NULL DEFAULT 0,
            other_fee_year_3 REAL NOT NULL DEFAULT 0,
            other_fee_year_4 REAL NOT NULL DEFAULT 0,
            current_course_period INTEGER NOT NULL DEFAULT 1 CHECK (current_course_period BETWEEN 1 AND 8),
            admission_cancelled INTEGER NOT NULL DEFAULT 0,
            admission_cancelled_at TEXT,
            admission_cancelled_by TEXT,
            created_by TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (branch_id, form_year, form_seq)
        )",
        "CREATE TABLE IF NOT EXISTS receipts (
            id TEXT PRIMARY KEY,
            receipt_seq INTEGER NOT NULL,
            receipt_year INTEGER NOT NULL,
            receipt_no TEXT NOT NULL DEFAULT '',
            receipt_date TEXT NOT NULL,
            student_id TEXT NOT NULL REFERENCES students(id),
            branch_id TEXT NOT NULL REFERENCES branches(id),
            fee_type TEXT NOT NULL DEFAULT 'Tuition' CHECK (fee_type IN ('Tuition','Other')),
            amount_paid REAL NOT NULL CHECK (amount_paid > 0),
            payment_mode TEXT NOT NULL CHECK (payment_mode IN ('Cash','UPI','DD','Cheque','NEFT','RTGS')),
            reference_no TEXT,
            cancelled INTEGER NOT NULL DEFAULT 0,
            cancelled_at TEXT,
            cancelled_by TEXT,
            created_by TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (branch_id, receipt_year, receipt_seq),
            CHECK (payment_mode = 'Cash' OR reference_no IS NOT NULL)
        )",
        "CREATE TABLE IF NOT EXISTS number_sequences (
            branch_id TEXT NOT NULL,
            doc_type TEXT NOT NULL CHECK (doc_type IN ('form','receipt')),
            academic_year INTEGER NOT NULL,
            last_value INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (branch_id, doc_type, academic_year)
        )",
        "CREATE INDEX IF NOT EXISTS idx_students_branch ON students (branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_receipts_branch ON receipts (branch_id)",
        "CREATE INDEX IF NOT EXISTS idx_receipts_student ON receipts (student_id)",
    ];
    for stmt in statements {
        sqlx::query(stmt)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Add columns introduced after the initial release to databases created by
/// older versions of the app (CREATE TABLE IF NOT EXISTS won't touch them).
async fn migrate_schema(pool: &SqlitePool) -> DbResult<()> {
    let additions = [
        (
            "students",
            "form_no",
            "ALTER TABLE students ADD COLUMN form_no TEXT NOT NULL DEFAULT ''",
        ),
        (
            "students",
            "surname",
            "ALTER TABLE students ADD COLUMN surname TEXT NOT NULL DEFAULT ''",
        ),
        (
            "students",
            "father_name",
            "ALTER TABLE students ADD COLUMN father_name TEXT NOT NULL DEFAULT ''",
        ),
        (
            "students",
            "district",
            "ALTER TABLE students ADD COLUMN district TEXT NOT NULL DEFAULT ''",
        ),
        (
            "students",
            "taluka",
            "ALTER TABLE students ADD COLUMN taluka TEXT NOT NULL DEFAULT ''",
        ),
        (
            "students",
            "pincode",
            "ALTER TABLE students ADD COLUMN pincode TEXT NOT NULL DEFAULT ''",
        ),
        (
            "students",
            "photo",
            "ALTER TABLE students ADD COLUMN photo TEXT NOT NULL DEFAULT ''",
        ),
        (
            "receipts",
            "receipt_no",
            "ALTER TABLE receipts ADD COLUMN receipt_no TEXT NOT NULL DEFAULT ''",
        ),
        (
            "receipts",
            "cancelled",
            "ALTER TABLE receipts ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "receipts",
            "cancelled_at",
            "ALTER TABLE receipts ADD COLUMN cancelled_at TEXT",
        ),
        (
            "receipts",
            "cancelled_by",
            "ALTER TABLE receipts ADD COLUMN cancelled_by TEXT",
        ),
        (
            "users",
            "can_admission",
            "ALTER TABLE users ADD COLUMN can_admission INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "users",
            "can_receipt",
            "ALTER TABLE users ADD COLUMN can_receipt INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "users",
            "can_outstanding",
            "ALTER TABLE users ADD COLUMN can_outstanding INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "users",
            "can_students",
            "ALTER TABLE users ADD COLUMN can_students INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "users",
            "can_promote",
            "ALTER TABLE users ADD COLUMN can_promote INTEGER NOT NULL DEFAULT 1",
        ),
    ];
    for (table, column, ddl) in additions {
        let exists: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?"
        ))
        .bind(column)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
        if exists == 0 {
            sqlx::query(ddl)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    // The roles table was seeded but never referenced (users.role is a CHECK
    // column); drop it from databases created by older versions.
    sqlx::query("DROP TABLE IF EXISTS roles")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // current_course_year was stored but never read — the current year is always
    // derived from current_course_period. Drop it from databases that still
    // carry it. Best-effort: a SQLite build that can't drop the column leaves a
    // harmless orphan column rather than blocking startup.
    let has_course_year: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('students') WHERE name = 'current_course_year'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    if has_course_year > 0 {
        if let Err(e) = sqlx::query("ALTER TABLE students DROP COLUMN current_course_year")
            .execute(pool)
            .await
        {
            eprintln!("GEWT: could not drop legacy current_course_year column: {e}");
        }
    }

    // Branch codes are fixed because they become part of stored document
    // numbers. Normalize the seeded branches on startup so older installs that
    // allowed edits are brought back to the canonical codes.
    let branch_code_drift: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM branches
         WHERE (id = '11111111-1111-1111-1111-111111111111' AND code != 'PRJ')
            OR (id = '22222222-2222-2222-2222-222222222222' AND code != 'HMT')
            OR (id = '33333333-3333-3333-3333-333333333333' AND code != 'TLD')",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    if branch_code_drift > 0 {
        let now = now_rfc3339();
        for (id, temp_code) in [
            ("11111111-1111-1111-1111-111111111111", "__GEWT_FIX_PRJ__"),
            ("22222222-2222-2222-2222-222222222222", "__GEWT_FIX_HMT__"),
            ("33333333-3333-3333-3333-333333333333", "__GEWT_FIX_TLD__"),
        ] {
            sqlx::query("UPDATE branches SET code = ?, updated_at = ? WHERE id = ?")
                .bind(temp_code)
                .bind(&now)
                .bind(id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
        for (id, code) in [
            ("11111111-1111-1111-1111-111111111111", "PRJ"),
            ("22222222-2222-2222-2222-222222222222", "HMT"),
            ("33333333-3333-3333-3333-333333333333", "TLD"),
        ] {
            sqlx::query("UPDATE branches SET code = ?, updated_at = ? WHERE id = ?")
                .bind(code)
                .bind(&now)
                .bind(id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    // Backfill letterheads onto the originally seeded courses, which shipped
    // with letterhead = NULL. Keyed by the stable seed ids so user-renamed
    // courses still match, and guarded on letterhead IS NULL so an admin's
    // later manual choice is never overwritten.
    for (id, letterhead) in [
        ("11111111-1111-1111-1111-000000000001", "PRJ-ANM-GNM.png"),
        ("11111111-1111-1111-1111-000000000002", "PRJ-B.Ed.png"),
        (
            "11111111-1111-1111-1111-000000000003",
            "PRJ-BSc-MSc-PBBSc.png",
        ),
        ("11111111-1111-1111-1111-000000000004", "PRJ-ANM-GNM.png"),
        ("11111111-1111-1111-1111-000000000005", "PRJ-M.Ed.png"),
        (
            "11111111-1111-1111-1111-000000000006",
            "PRJ-BSc-MSc-PBBSc.png",
        ),
        (
            "11111111-1111-1111-1111-000000000007",
            "PRJ-BSc-MSc-PBBSc.png",
        ),
        ("11111111-1111-1111-1111-000000000008", "PRJ-ptc.png"),
        (
            "22222222-2222-2222-2222-000000000001",
            "HMT-PBBSc-B.Sc-GNM.png",
        ),
        (
            "22222222-2222-2222-2222-000000000002",
            "HMT-PBBSc-B.Sc-GNM.png",
        ),
        (
            "22222222-2222-2222-2222-000000000003",
            "HMT-PBBSc-B.Sc-GNM.png",
        ),
        (
            "33333333-3333-3333-3333-000000000001",
            "TLD-B.Sc-PBBSc-GNM.png",
        ),
        (
            "33333333-3333-3333-3333-000000000002",
            "TLD-B.Sc-PBBSc-GNM.png",
        ),
        (
            "33333333-3333-3333-3333-000000000003",
            "TLD-B.Sc-PBBSc-GNM.png",
        ),
    ] {
        sqlx::query(
            "UPDATE courses SET letterhead = ?, updated_at = ?
             WHERE id = ? AND letterhead IS NULL",
        )
        .bind(letterhead)
        .bind(now_rfc3339())
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    // The seeded MSW course is a four-semester program. Existing databases may
    // still carry the original equivalent "2 years" labels; update only that
    // exact seeded row/default shape.
    sqlx::query(
        "UPDATE courses SET duration = 4, duration_type = 'semester', updated_at = ?
         WHERE id = '11111111-1111-1111-1111-000000000011'
           AND duration = 2
           AND duration_type = 'year'",
    )
    .bind(now_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Document numbers are frozen at creation. Rows that predate this rule (or
/// arrive via an older backup file) carry an empty string; compose their number
/// once from the current branch code so it never changes again.
pub async fn backfill_document_numbers(pool: &SqlitePool) -> DbResult<()> {
    sqlx::query(
        "UPDATE students SET form_no = (
            SELECT b.code || '-' || students.form_seq || '-' || students.form_year
            FROM branches b
            WHERE b.id = students.branch_id
         )
         WHERE form_no = ''",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query(
        "UPDATE receipts SET receipt_no = (
            SELECT b.code || '-' || receipts.receipt_seq
            FROM branches b
            WHERE b.id = receipts.branch_id
         )
         WHERE receipt_no = ''",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    seed_receipt_sequence_buckets(pool).await?;
    Ok(())
}

async fn seed_receipt_sequence_buckets(pool: &SqlitePool) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO number_sequences (branch_id, doc_type, academic_year, last_value)
         SELECT branch_id, 'receipt', 0, MAX(receipt_seq)
         FROM receipts
         GROUP BY branch_id
         ON CONFLICT (branch_id, doc_type, academic_year)
         DO UPDATE SET last_value = MAX(last_value, excluded.last_value)",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

async fn seed_if_empty(pool: &SqlitePool) -> DbResult<()> {
    let now = now_rfc3339();

    const PRJ: &str = "11111111-1111-1111-1111-111111111111";
    const HMT: &str = "22222222-2222-2222-2222-222222222222";
    const TLD: &str = "33333333-3333-3333-3333-333333333333";

    // Branches use STABLE, deterministic ids so that the same branch has the
    // same id on every machine. This is what makes branch-partitioned backup
    // import work across independent machines (branch_id references align, and
    // re-seeding never creates a conflicting duplicate).
    for (id, code, name) in [
        (PRJ, "PRJ", "Prantij"),
        (HMT, "HMT", "HMT"),
        (TLD, "TLD", "Talod"),
    ] {
        sqlx::query(
            "INSERT OR IGNORE INTO branches (id, code, name, updated_at) VALUES (?, ?, ?, ?)",
        )
        .bind(id)
        .bind(code)
        .bind(name)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Initial course catalog, ordered alphabetically within each branch.
    // Letterheads live in public/letterheads/ and are named Branch-Courses.png.
    // A single sheet often covers several programs, so those courses share one
    // file: ANM/GNM -> PRJ-ANM-GNM.png, B.Sc./M.Sc./P.B.B.Sc. -> PRJ-BSc-MSc-PBBSc.png,
    // and each of HMT/TLD has one combined nursing sheet for all its courses.
    for (id, branch_id, name, duration, duration_type, letterhead) in [
        (
            "11111111-1111-1111-1111-000000000001",
            PRJ,
            "ANM",
            2,
            "year",
            "PRJ-ANM-GNM.png",
        ),
        (
            "11111111-1111-1111-1111-000000000009",
            PRJ,
            "B.A.",
            6,
            "semester",
            "PRJ-BA.png",
        ),
        (
            "11111111-1111-1111-1111-000000000002",
            PRJ,
            "B.Ed.",
            4,
            "semester",
            "PRJ-B.Ed.png",
        ),
        (
            "11111111-1111-1111-1111-000000000003",
            PRJ,
            "B.Sc.",
            8,
            "semester",
            "PRJ-BSc-MSc-PBBSc.png",
        ),
        (
            "11111111-1111-1111-1111-000000000010",
            PRJ,
            "Fire & Safety",
            1,
            "year",
            "PRJ-fire-and-safety.png",
        ),
        (
            "11111111-1111-1111-1111-000000000004",
            PRJ,
            "GNM",
            3,
            "year",
            "PRJ-ANM-GNM.png",
        ),
        (
            "11111111-1111-1111-1111-000000000005",
            PRJ,
            "M.Ed",
            4,
            "semester",
            "PRJ-M.Ed.png",
        ),
        (
            "11111111-1111-1111-1111-000000000006",
            PRJ,
            "M.Sc.",
            4,
            "semester",
            "PRJ-BSc-MSc-PBBSc.png",
        ),
        (
            "11111111-1111-1111-1111-000000000011",
            PRJ,
            "MSW",
            4,
            "semester",
            "PRJ-MSW.png",
        ),
        (
            "11111111-1111-1111-1111-000000000007",
            PRJ,
            "P.B.B.Sc.",
            4,
            "semester",
            "PRJ-BSc-MSc-PBBSc.png",
        ),
        (
            "11111111-1111-1111-1111-000000000008",
            PRJ,
            "PTC",
            2,
            "year",
            "PRJ-ptc.png",
        ),
        (
            "11111111-1111-1111-1111-000000000012",
            PRJ,
            "S.I.",
            1,
            "year",
            "PRJ-sanitary-inspector.png",
        ),
        (
            "22222222-2222-2222-2222-000000000001",
            HMT,
            "B.Sc.",
            8,
            "semester",
            "HMT-PBBSc-B.Sc-GNM.png",
        ),
        (
            "22222222-2222-2222-2222-000000000002",
            HMT,
            "GNM",
            3,
            "year",
            "HMT-PBBSc-B.Sc-GNM.png",
        ),
        (
            "22222222-2222-2222-2222-000000000003",
            HMT,
            "P.B.B.Sc.",
            4,
            "semester",
            "HMT-PBBSc-B.Sc-GNM.png",
        ),
        (
            "33333333-3333-3333-3333-000000000001",
            TLD,
            "B.Sc.",
            8,
            "semester",
            "TLD-B.Sc-PBBSc-GNM.png",
        ),
        (
            "33333333-3333-3333-3333-000000000002",
            TLD,
            "GNM",
            3,
            "year",
            "TLD-B.Sc-PBBSc-GNM.png",
        ),
        (
            "33333333-3333-3333-3333-000000000003",
            TLD,
            "P.B.B.Sc.",
            4,
            "semester",
            "TLD-B.Sc-PBBSc-GNM.png",
        ),
    ] {
        sqlx::query(
            "INSERT OR IGNORE INTO courses (id, branch_id, name, duration, duration_type, letterhead, active, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
        )
        .bind(id)
        .bind(branch_id)
        .bind(name)
        .bind(duration)
        .bind(duration_type)
        .bind(letterhead)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(friendly_db_error)?;
    }

    sqlx::query(
        "INSERT OR IGNORE INTO academic_settings (id, academic_year_start_month, updated_at)
         VALUES (1, 9, ?)",
    )
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // The default admin also uses a stable id so re-seeding on another machine
    // doesn't collide with an imported admin account (same id, same user_id).
    sqlx::query(
        "INSERT OR IGNORE INTO users (id, user_id, name, password_hash, role, branch_id, active, updated_at)
         VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'irrn', 'IRRN', ?, 'admin', NULL, 1, ?)",
    )
    .bind(DEFAULT_ADMIN_HASH)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Data types (shapes match the frontend TypeScript types exactly)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Branch {
    pub id: String,
    pub code: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Course {
    pub id: String,
    pub branch_id: String,
    pub name: String,
    pub duration: i64,
    pub duration_type: String,
    pub letterhead: Option<String>,
    pub active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub role: String,
    pub branch_id: Option<String>,
    pub active: bool,
    pub can_admission: bool,
    pub can_receipt: bool,
    pub can_outstanding: bool,
    pub can_students: bool,
    pub can_promote: bool,
}

#[derive(Debug, Serialize)]
pub struct Me {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub role: String,
    pub branch_id: Option<String>,
    pub can_admission: bool,
    pub can_receipt: bool,
    pub can_outstanding: bool,
    pub can_students: bool,
    pub can_promote: bool,
    pub branch_name: Option<String>,
    pub academic_year_start_month: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct Student {
    pub id: String,
    pub form_no: String,
    pub admission_date: String,
    pub branch_id: String,
    pub branch_name: String,
    pub course_id: String,
    pub course_name: String,
    pub course_duration: i64,
    pub course_duration_type: String,
    pub current_course_period: i64,
    pub student_name: String,
    pub surname: String,
    pub father_name: String,
    pub category: String,
    pub religion: String,
    pub caste: String,
    pub gender: String,
    pub aadhar: String,
    pub address: String,
    pub district: String,
    pub taluka: String,
    pub pincode: String,
    pub student_phone: String,
    pub parent_phone: String,
    pub photo: String,
    pub fee_year_1: f64,
    pub fee_year_2: f64,
    pub fee_year_3: f64,
    pub fee_year_4: f64,
    pub tuition_fee_year_1: f64,
    pub tuition_fee_year_2: f64,
    pub tuition_fee_year_3: f64,
    pub tuition_fee_year_4: f64,
    pub other_fee_year_1: f64,
    pub other_fee_year_2: f64,
    pub other_fee_year_3: f64,
    pub other_fee_year_4: f64,
    pub admission_cancelled: bool,
    pub admission_cancelled_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Receipt {
    pub id: String,
    pub receipt_no: String,
    pub receipt_date: String,
    pub student_id: String,
    pub branch_id: String,
    pub fee_type: String,
    pub amount_paid: f64,
    pub payment_mode: String,
    pub reference_no: Option<String>,
    pub cancelled: bool,
    pub cancelled_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OutstandingFeeBreakdown {
    pub due: f64,
    pub paid: f64,
    pub pending: f64,
}

#[derive(Debug, Serialize)]
pub struct OutstandingYearBreakdown {
    pub year: i32,
    pub tuition: OutstandingFeeBreakdown,
    pub other: OutstandingFeeBreakdown,
    pub total_due: f64,
    pub total_paid: f64,
    pub pending: f64,
}

#[derive(Debug, Serialize)]
pub struct OutstandingRow {
    #[serde(flatten)]
    pub student: Student,
    pub total_due: f64,
    pub total_paid: f64,
    pub pending: f64,
    pub current_period: String,
    pub last_receipt_no: Option<String>,
    pub year_breakdown: Vec<OutstandingYearBreakdown>,
}

macro_rules! impl_from_row {
    ($ty:ty { $($field:ident),+ $(,)? }) => {
        impl<'r> sqlx::FromRow<'r, sqlx::sqlite::SqliteRow> for $ty {
            fn from_row(row: &'r sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
                Ok(Self {
                    $($field: row.try_get(stringify!($field))?,)+
                })
            }
        }
    };
}

impl_from_row!(Branch { id, code, name });
impl_from_row!(Course {
    id,
    branch_id,
    name,
    duration,
    duration_type,
    letterhead,
    active
});
impl_from_row!(User {
    id,
    user_id,
    name,
    role,
    branch_id,
    active,
    can_admission,
    can_receipt,
    can_outstanding,
    can_students,
    can_promote,
});
impl_from_row!(Me {
    id,
    user_id,
    name,
    role,
    branch_id,
    can_admission,
    can_receipt,
    can_outstanding,
    can_students,
    can_promote,
    branch_name,
    academic_year_start_month,
});
impl_from_row!(Student {
    id,
    form_no,
    admission_date,
    branch_id,
    branch_name,
    course_id,
    course_name,
    course_duration,
    course_duration_type,
    current_course_period,
    student_name,
    surname,
    father_name,
    category,
    religion,
    caste,
    gender,
    aadhar,
    address,
    district,
    taluka,
    pincode,
    student_phone,
    parent_phone,
    photo,
    fee_year_1,
    fee_year_2,
    fee_year_3,
    fee_year_4,
    tuition_fee_year_1,
    tuition_fee_year_2,
    tuition_fee_year_3,
    tuition_fee_year_4,
    other_fee_year_1,
    other_fee_year_2,
    other_fee_year_3,
    other_fee_year_4,
    admission_cancelled,
    admission_cancelled_at,
});
impl_from_row!(Receipt {
    id,
    receipt_no,
    receipt_date,
    student_id,
    branch_id,
    fee_type,
    amount_paid,
    payment_mode,
    reference_no,
    cancelled,
    cancelled_at,
});

// Request payloads (from the frontend).
#[derive(Debug, Deserialize)]
pub struct StudentRequest {
    pub admission_date: String,
    pub branch_id: String,
    pub course_id: String,
    pub student_name: String,
    #[serde(default)]
    pub surname: String,
    #[serde(default)]
    pub father_name: String,
    pub category: String,
    pub religion: String,
    pub caste: String,
    pub gender: String,
    pub aadhar: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub district: String,
    #[serde(default)]
    pub taluka: String,
    #[serde(default)]
    pub pincode: String,
    pub student_phone: String,
    pub parent_phone: String,
    #[serde(default)]
    pub photo: String,
    pub fee_year_1: f64,
    pub fee_year_2: f64,
    pub fee_year_3: f64,
    pub fee_year_4: f64,
    pub tuition_fee_year_1: Option<f64>,
    pub tuition_fee_year_2: Option<f64>,
    pub tuition_fee_year_3: Option<f64>,
    pub tuition_fee_year_4: Option<f64>,
    pub other_fee_year_1: Option<f64>,
    pub other_fee_year_2: Option<f64>,
    pub other_fee_year_3: Option<f64>,
    pub other_fee_year_4: Option<f64>,
    pub current_course_period: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ReceiptRequest {
    pub student_id: String,
    pub receipt_date: String,
    pub fee_type: String,
    pub amount_paid: f64,
    pub payment_mode: String,
    pub reference_no: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CourseRequest {
    pub branch_id: String,
    pub name: String,
    pub duration: i64,
    pub duration_type: String,
    pub letterhead: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UserRequest {
    pub user_id: String,
    pub name: String,
    pub role: String,
    pub branch_id: Option<String>,
    pub password: Option<String>,
    #[serde(default = "default_active")]
    pub active: bool,
    #[serde(default = "default_active")]
    pub can_admission: bool,
    #[serde(default = "default_active")]
    pub can_receipt: bool,
    #[serde(default = "default_active")]
    pub can_outstanding: bool,
    #[serde(default = "default_active")]
    pub can_students: bool,
    #[serde(default = "default_active")]
    pub can_promote: bool,
}

fn default_active() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct PromoteRequest {
    pub course_id: String,
    pub admission_year: i32,
    pub student_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PromoteResponse {
    pub promoted_count: usize,
    pub skipped_count: usize,
    pub students: Vec<Student>,
}

#[derive(Debug, Deserialize)]
pub struct SettingsRequest {
    pub academic_year_start_month: i64,
}

struct StudentFees {
    yearly: [f64; 4],
    tuition: [f64; 4],
    other: [f64; 4],
}

impl StudentFees {
    fn zero() -> Self {
        Self {
            yearly: [0.0; 4],
            tuition: [0.0; 4],
            other: [0.0; 4],
        }
    }
}

fn existing_student_fees(student: &Student) -> StudentFees {
    StudentFees {
        yearly: [
            student.fee_year_1,
            student.fee_year_2,
            student.fee_year_3,
            student.fee_year_4,
        ],
        tuition: [
            student.tuition_fee_year_1,
            student.tuition_fee_year_2,
            student.tuition_fee_year_3,
            student.tuition_fee_year_4,
        ],
        other: [
            student.other_fee_year_1,
            student.other_fee_year_2,
            student.other_fee_year_3,
            student.other_fee_year_4,
        ],
    }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/// Verify credentials and return the user identity used for the session.
pub async fn authenticate(pool: &SqlitePool, user_id: &str, password: &str) -> DbResult<User> {
    let row: Option<(
        String,
        String,
        String,
        String,
        Option<String>,
        bool,
        bool,
        bool,
        bool,
        bool,
    )> = sqlx::query_as(
        "SELECT id, name, password_hash, role, branch_id, can_admission, can_receipt, can_outstanding, can_students, can_promote
         FROM users WHERE user_id = ? AND active = 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let Some(row) = row else {
        // Run a dummy verification so an unknown user ID takes as long as a
        // wrong password — otherwise response timing reveals which IDs exist.
        if let Ok(parsed) = PasswordHash::new(DEFAULT_ADMIN_HASH) {
            let _ = Argon2::default().verify_password(password.as_bytes(), &parsed);
        }
        return Err("Invalid user ID or password".to_string());
    };
    let parsed =
        PasswordHash::new(&row.2).map_err(|_| "Invalid user ID or password".to_string())?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| "Invalid user ID or password".to_string())?;

    Ok(User {
        id: row.0,
        user_id: user_id.to_string(),
        name: row.1,
        role: row.3,
        branch_id: row.4,
        // The lookup query filters on active = 1.
        active: true,
        can_admission: row.5,
        can_receipt: row.6,
        can_outstanding: row.7,
        can_students: row.8,
        can_promote: row.9,
    })
}

/// Verify the password for the currently logged-in database user id.
pub async fn verify_user_password(
    pool: &SqlitePool,
    user_db_id: &str,
    password: &str,
) -> DbResult<()> {
    let password_hash = sqlx::query_scalar::<_, String>(
        "SELECT password_hash FROM users WHERE id = ? AND active = 1",
    )
    .bind(user_db_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let Some(password_hash) = password_hash else {
        if let Ok(parsed) = PasswordHash::new(DEFAULT_ADMIN_HASH) {
            let _ = Argon2::default().verify_password(password.as_bytes(), &parsed);
        }
        return Err("Invalid password".to_string());
    };

    let parsed = PasswordHash::new(&password_hash).map_err(|_| "Invalid password".to_string())?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| "Invalid password".to_string())
}

pub async fn load_me(pool: &SqlitePool, user_id: &str) -> DbResult<Me> {
    sqlx::query_as::<_, Me>(
        "SELECT u.id, u.user_id, u.name, u.role, u.branch_id,
         u.can_admission, u.can_receipt, u.can_outstanding, u.can_students, u.can_promote,
         b.name AS branch_name,
         s.academic_year_start_month
         FROM users u
         LEFT JOIN branches b ON b.id = u.branch_id
         CROSS JOIN academic_settings s
         WHERE u.id = ?",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())
}

fn hash_password(password: &str) -> DbResult<String> {
    let salt = SaltString::generate(&mut rand_core::OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| "Could not hash password".to_string())
}

// ---------------------------------------------------------------------------
// Branches / courses / users / settings
// ---------------------------------------------------------------------------

pub async fn list_branches(
    pool: &SqlitePool,
    branch_filter: Option<&str>,
) -> DbResult<Vec<Branch>> {
    let rows = if let Some(bid) = branch_filter {
        sqlx::query_as("SELECT id, code, name FROM branches WHERE id = ? ORDER BY name")
            .bind(bid)
            .fetch_all(pool)
            .await
    } else {
        sqlx::query_as("SELECT id, code, name FROM branches ORDER BY name")
            .fetch_all(pool)
            .await
    };
    rows.map_err(|e| e.to_string())
}

/// Branch codes are fixed because they are embedded in issued document numbers.
pub async fn update_branch_code(_pool: &SqlitePool, _id: &str, _code: &str) -> DbResult<Branch> {
    Err("Branch codes are fixed and cannot be changed".to_string())
}

pub async fn list_courses(
    pool: &SqlitePool,
    branch_filter: Option<&str>,
    include_archived: bool,
) -> DbResult<Vec<Course>> {
    let mut sql = String::from(
        "SELECT id, branch_id, name, duration, duration_type, letterhead, active FROM courses",
    );
    let mut clauses: Vec<&str> = Vec::new();
    if !include_archived {
        clauses.push("active = 1");
    }
    if branch_filter.is_some() {
        clauses.push("branch_id = ?");
    }
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY name");
    let mut query = sqlx::query_as::<_, Course>(&sql);
    if let Some(bid) = branch_filter {
        query = query.bind(bid.to_string());
    }
    query.fetch_all(pool).await.map_err(|e| e.to_string())
}

fn validate_course_request(req: &CourseRequest) -> DbResult<()> {
    if req.name.trim().is_empty() {
        return Err("Course name is required".to_string());
    }
    if !["year", "semester"].contains(&req.duration_type.as_str()) {
        return Err("Invalid duration type".to_string());
    }
    if req.duration < 1 {
        return Err("Duration must be at least 1".to_string());
    }
    if req.duration_type == "semester" && req.duration % 2 != 0 {
        return Err("Semester courses must have an even number of semesters".to_string());
    }
    // The fee model only has four year columns (and the schema caps the current
    // period at 8), so the rest of the system bills at most 4 years / 8
    // semesters. Reject longer courses here rather than create one that can
    // never bill its final years.
    let max_duration = if req.duration_type == "semester" { 8 } else { 4 };
    if req.duration > max_duration {
        return Err(format!(
            "Duration cannot exceed {max_duration} {}s",
            req.duration_type
        ));
    }
    Ok(())
}

/// Map raw SQLite constraint messages to text a clerk can act on.
fn friendly_db_error(error: sqlx::Error) -> String {
    let message = error.to_string();
    if message.contains("UNIQUE constraint failed: courses.branch_id, courses.name") {
        return "A course with this name already exists in this branch".to_string();
    }
    if message.contains("UNIQUE constraint failed: users.user_id") {
        return "This user ID is already taken".to_string();
    }
    if message.contains("UNIQUE constraint failed: branches.code") {
        return "This branch code is already in use".to_string();
    }
    if message.contains("UNIQUE constraint failed: students.branch_id") {
        return "A student with this form number already exists in this branch".to_string();
    }
    if message.contains("UNIQUE constraint failed: receipts.branch_id") {
        return "A receipt with this number already exists in this branch".to_string();
    }
    message
}

pub async fn create_course(pool: &SqlitePool, req: CourseRequest) -> DbResult<Course> {
    validate_course_request(&req)?;
    let id = new_id();
    sqlx::query(
        "INSERT INTO courses (id, branch_id, name, duration, duration_type, letterhead, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
    )
    .bind(&id)
    .bind(&req.branch_id)
    .bind(req.name.trim())
    .bind(req.duration)
    .bind(&req.duration_type)
    .bind(&req.letterhead)
    .bind(now_rfc3339())
    .execute(pool)
    .await
    .map_err(friendly_db_error)?;
    load_course(pool, &id).await
}

pub async fn update_course(pool: &SqlitePool, id: &str, req: CourseRequest) -> DbResult<Course> {
    validate_course_request(&req)?;
    let existing = load_course(pool, id).await?;
    if existing.branch_id != req.branch_id {
        // A course with admitted students anchors their branch and numbering;
        // moving it would strand them under a branch they don't belong to.
        let enrolled: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM students WHERE course_id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
        if enrolled > 0 {
            return Err(
                "This course has admitted students and cannot move to another branch".to_string(),
            );
        }
    }
    sqlx::query(
        "UPDATE courses SET branch_id = ?, name = ?, duration = ?, duration_type = ?, letterhead = ?, updated_at = ?
         WHERE id = ? AND active = 1",
    )
    .bind(&req.branch_id)
    .bind(req.name.trim())
    .bind(req.duration)
    .bind(&req.duration_type)
    .bind(&req.letterhead)
    .bind(now_rfc3339())
    .bind(id)
    .execute(pool)
    .await
    .map_err(friendly_db_error)?;
    load_course(pool, id).await
}

async fn load_course(pool: &SqlitePool, id: &str) -> DbResult<Course> {
    sqlx::query_as("SELECT id, branch_id, name, duration, duration_type, letterhead, active FROM courses WHERE id = ? AND active = 1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Course not found".to_string())
}

/// Load a course regardless of archive state (for archive management and for
/// operations on students who remain enrolled in an archived course).
async fn load_course_any(pool: &SqlitePool, id: &str) -> DbResult<Course> {
    sqlx::query_as("SELECT id, branch_id, name, duration, duration_type, letterhead, active FROM courses WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Course not found".to_string())
}

/// Archive (active = false) or restore (active = true) a course. Archived
/// courses disappear from pickers but their admitted students keep working.
pub async fn set_course_active(pool: &SqlitePool, id: &str, active: bool) -> DbResult<Course> {
    let result = sqlx::query("UPDATE courses SET active = ?, updated_at = ? WHERE id = ?")
        .bind(active)
        .bind(now_rfc3339())
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err("Course not found".to_string());
    }
    load_course_any(pool, id).await
}

/// Permanently delete a course. Only allowed when no student (active or
/// cancelled) was ever admitted to it — those records reference the course.
pub async fn delete_course(pool: &SqlitePool, id: &str) -> DbResult<()> {
    let enrolled: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM students WHERE course_id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    if enrolled > 0 {
        return Err(
            "This course has admitted students and cannot be deleted; archive it instead"
                .to_string(),
        );
    }
    let result = sqlx::query("DELETE FROM courses WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err("Course not found".to_string());
    }
    Ok(())
}

pub async fn list_users(pool: &SqlitePool) -> DbResult<Vec<User>> {
    sqlx::query_as(
        "SELECT id, user_id, name, role, branch_id, active, can_admission, can_receipt, can_outstanding, can_students, can_promote FROM users ORDER BY name",
    )
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

fn normalize_user_request(req: &UserRequest) -> DbResult<(String, String, String, Option<String>)> {
    let user_id = req.user_id.trim().to_string();
    let name = req.name.trim().to_string();
    let role = req.role.trim().to_string();
    if user_id.is_empty() {
        return Err("User ID is required".to_string());
    }
    if name.is_empty() {
        return Err("Name is required".to_string());
    }
    if role != "admin" && role != "employee" {
        return Err("Invalid role".to_string());
    }
    if role == "employee" && req.branch_id.is_none() {
        return Err("Branch is required for employee users".to_string());
    }
    let branch_id = if role == "admin" {
        None
    } else {
        req.branch_id.clone()
    };
    Ok((user_id, name, role, branch_id))
}

pub async fn create_user(pool: &SqlitePool, req: UserRequest) -> DbResult<User> {
    let (user_id, name, role, branch_id) = normalize_user_request(&req)?;
    let password = req
        .password
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Password is required".to_string())?;
    let id = new_id();
    sqlx::query(
        "INSERT INTO users (id, user_id, name, password_hash, role, branch_id, active, can_admission, can_receipt, can_outstanding, can_students, can_promote, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&user_id)
    .bind(&name)
    .bind(hash_password(password)?)
    .bind(&role)
    .bind(&branch_id)
    .bind(req.can_admission)
    .bind(req.can_receipt)
    .bind(req.can_outstanding)
    .bind(req.can_students)
    .bind(req.can_promote)
    .bind(now_rfc3339())
    .execute(pool)
    .await
    .map_err(friendly_db_error)?;
    Ok(User {
        id,
        user_id,
        name,
        role,
        branch_id,
        active: true,
        can_admission: req.can_admission,
        can_receipt: req.can_receipt,
        can_outstanding: req.can_outstanding,
        can_students: req.can_students,
        can_promote: req.can_promote,
    })
}

pub async fn update_user(pool: &SqlitePool, id: &str, req: UserRequest) -> DbResult<User> {
    let (user_id, name, role, branch_id) = normalize_user_request(&req)?;

    // Never allow the last active admin to be deactivated or demoted — that
    // would lock administration out of the app permanently.
    let target: Option<(String, bool)> =
        sqlx::query_as("SELECT role, active FROM users WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    let (current_role, currently_active) = target.ok_or_else(|| "User not found".to_string())?;
    if current_role == "admin" && currently_active && (role != "admin" || !req.active) {
        let other_admins: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id != ?",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
        if other_admins == 0 {
            return Err("Cannot demote or deactivate the only active admin".to_string());
        }
    }

    let now = now_rfc3339();
    let result = if let Some(password) = req
        .password
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        sqlx::query(
            "UPDATE users SET user_id = ?, name = ?, role = ?, branch_id = ?, active = ?, password_hash = ?, can_admission = ?, can_receipt = ?, can_outstanding = ?, can_students = ?, can_promote = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&user_id)
        .bind(&name)
        .bind(&role)
        .bind(&branch_id)
        .bind(req.active)
        .bind(hash_password(password)?)
        .bind(req.can_admission)
        .bind(req.can_receipt)
        .bind(req.can_outstanding)
        .bind(req.can_students)
        .bind(req.can_promote)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await
        .map_err(friendly_db_error)?
    } else {
        sqlx::query(
            "UPDATE users SET user_id = ?, name = ?, role = ?, branch_id = ?, active = ?, can_admission = ?, can_receipt = ?, can_outstanding = ?, can_students = ?, can_promote = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&user_id)
        .bind(&name)
        .bind(&role)
        .bind(&branch_id)
        .bind(req.active)
        .bind(req.can_admission)
        .bind(req.can_receipt)
        .bind(req.can_outstanding)
        .bind(req.can_students)
        .bind(req.can_promote)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await
        .map_err(friendly_db_error)?
    };
    if result.rows_affected() == 0 {
        return Err("User not found".to_string());
    }
    Ok(User {
        id: id.to_string(),
        user_id,
        name,
        role,
        branch_id,
        active: req.active,
        can_admission: req.can_admission,
        can_receipt: req.can_receipt,
        can_outstanding: req.can_outstanding,
        can_students: req.can_students,
        can_promote: req.can_promote,
    })
}

pub async fn update_settings(pool: &SqlitePool, req: SettingsRequest) -> DbResult<()> {
    if !(1..=12).contains(&req.academic_year_start_month) {
        return Err("Academic year start month must be between 1 and 12".to_string());
    }
    sqlx::query(
        "UPDATE academic_settings
         SET academic_year_start_month = ?, updated_at = ?
         WHERE id = 1",
    )
    .bind(req.academic_year_start_month)
    .bind(now_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Numbering: forms are {branch-code}-{seq}-{academic-year}; receipts are
// {branch-code}-{seq}. Receipt sequences use academic_year = 0 so yearless
// visible numbers do not repeat annually.
// ---------------------------------------------------------------------------

/// The academic year that a given `YYYY-MM-DD` date falls into, labelled by its
/// starting calendar year. e.g. with start month 9, 2026-09-01 -> 2026 and
/// 2026-06-01 -> 2025.
fn academic_year(date: &str, start_month: i64) -> DbResult<i32> {
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() < 2 {
        return Err("Invalid date".to_string());
    }
    let year: i32 = parts[0].parse().map_err(|_| "Invalid date".to_string())?;
    let month: i64 = parts[1].parse().map_err(|_| "Invalid date".to_string())?;
    if !(1..=12).contains(&month) {
        return Err("Invalid date".to_string());
    }
    Ok(if month >= start_month { year } else { year - 1 })
}

async fn start_month(pool: &SqlitePool) -> DbResult<i64> {
    sqlx::query_scalar("SELECT academic_year_start_month FROM academic_settings WHERE id = 1")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
}

async fn branch_code(pool: &SqlitePool, branch_id: &str) -> DbResult<String> {
    sqlx::query_scalar("SELECT code FROM branches WHERE id = ?")
        .bind(branch_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Branch not found".to_string())
}

/// Peek the next sequence value without consuming it (for form previews).
async fn peek_seq(pool: &SqlitePool, branch_id: &str, doc_type: &str, year: i32) -> DbResult<i64> {
    let last: Option<i64> = sqlx::query_scalar(
        "SELECT last_value FROM number_sequences WHERE branch_id = ? AND doc_type = ? AND academic_year = ?",
    )
    .bind(branch_id)
    .bind(doc_type)
    .bind(year)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(last.unwrap_or(0) + 1)
}

/// Atomically consume and return the next sequence value within a transaction.
async fn next_seq(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    branch_id: &str,
    doc_type: &str,
    year: i32,
) -> DbResult<i64> {
    let value: i64 = sqlx::query_scalar(
        "INSERT INTO number_sequences (branch_id, doc_type, academic_year, last_value)
         VALUES (?, ?, ?, 1)
         ON CONFLICT (branch_id, doc_type, academic_year)
         DO UPDATE SET last_value = last_value + 1
         RETURNING last_value",
    )
    .bind(branch_id)
    .bind(doc_type)
    .bind(year)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(value)
}

fn sequence_year(doc_type: &str, document_year: i32) -> i32 {
    if doc_type == "receipt" {
        0
    } else {
        document_year
    }
}

fn compose_form_no(branch_code: &str, seq: i64, year: i32) -> String {
    format!("{branch_code}-{seq}-{year}")
}

fn compose_receipt_no(branch_code: &str, seq: i64) -> String {
    format!("{branch_code}-{seq}")
}

/// Composite preview of the next form/receipt number for a branch + date.
pub async fn preview_number(
    pool: &SqlitePool,
    branch_id: &str,
    doc_type: &str,
    date: &str,
) -> DbResult<String> {
    let month = start_month(pool).await?;
    let year = academic_year(date, month)?;
    let seq = peek_seq(pool, branch_id, doc_type, sequence_year(doc_type, year)).await?;
    let bcode = branch_code(pool, branch_id).await?;
    Ok(if doc_type == "receipt" {
        compose_receipt_no(&bcode, seq)
    } else {
        compose_form_no(&bcode, seq, year)
    })
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

fn student_select(where_clause: &str) -> String {
    format!(
        "SELECT s.id,
         COALESCE(NULLIF(s.form_no, ''), b.code || '-' || s.form_seq || '-' || s.form_year) AS form_no,
         s.admission_date, s.branch_id, b.name AS branch_name, s.course_id, c.name AS course_name,
         c.duration AS course_duration, c.duration_type AS course_duration_type,
         s.current_course_period,
         s.student_name, s.surname, s.father_name, s.category, s.religion, s.caste, s.gender,
         s.aadhar, s.address, s.district, s.taluka, s.pincode, s.student_phone, s.parent_phone, s.photo,
         s.fee_year_1, s.fee_year_2, s.fee_year_3, s.fee_year_4,
         s.tuition_fee_year_1, s.tuition_fee_year_2, s.tuition_fee_year_3, s.tuition_fee_year_4,
         s.other_fee_year_1, s.other_fee_year_2, s.other_fee_year_3, s.other_fee_year_4,
         s.admission_cancelled, s.admission_cancelled_at
         FROM students s
         JOIN branches b ON b.id = s.branch_id
         JOIN courses c ON c.id = s.course_id
         {where_clause}
         ORDER BY s.form_year DESC, s.form_seq ASC"
    )
}

pub async fn list_students(
    pool: &SqlitePool,
    branch_filter: Option<&str>,
    include_cancelled: bool,
) -> DbResult<Vec<Student>> {
    let sql = match (branch_filter.is_some(), include_cancelled) {
        (true, true) => student_select("WHERE s.branch_id = ?"),
        (true, false) => student_select("WHERE s.branch_id = ? AND s.admission_cancelled = 0"),
        (false, true) => student_select(""),
        (false, false) => student_select("WHERE s.admission_cancelled = 0"),
    };
    let mut query = sqlx::query_as::<_, Student>(&sql);
    if let Some(bid) = branch_filter {
        query = query.bind(bid.to_string());
    }
    query.fetch_all(pool).await.map_err(|e| e.to_string())
}

pub async fn load_student(pool: &SqlitePool, id: &str) -> DbResult<Student> {
    sqlx::query_as::<_, Student>(&student_select("WHERE s.id = ?"))
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Validate a `YYYY-MM-DD` date string as a real calendar date in a sane range.
/// Date inputs reach the backend as raw strings; a cleared input ("") or a
/// mistyped year would otherwise create sequences for bogus academic years.
fn validate_date(date: &str, what: &str) -> DbResult<()> {
    use chrono::Datelike;
    let parsed = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| format!("{what} must be a valid date (YYYY-MM-DD)"))?;
    if !(1900..=2100).contains(&parsed.year()) {
        return Err(format!("{what} year must be between 1900 and 2100"));
    }
    Ok(())
}

fn normalize_student_fees(req: &StudentRequest) -> DbResult<StudentFees> {
    let yearly = [
        req.fee_year_1,
        req.fee_year_2,
        req.fee_year_3,
        req.fee_year_4,
    ];
    let tuition = [
        req.tuition_fee_year_1.unwrap_or(req.fee_year_1),
        req.tuition_fee_year_2.unwrap_or(req.fee_year_2),
        req.tuition_fee_year_3.unwrap_or(req.fee_year_3),
        req.tuition_fee_year_4.unwrap_or(req.fee_year_4),
    ];
    let other = [
        req.other_fee_year_1.unwrap_or(0.0),
        req.other_fee_year_2.unwrap_or(0.0),
        req.other_fee_year_3.unwrap_or(0.0),
        req.other_fee_year_4.unwrap_or(0.0),
    ];
    for i in 0..4 {
        if yearly[i] < 0.0 || tuition[i] < 0.0 || other[i] < 0.0 {
            return Err("Fee amounts cannot be negative".to_string());
        }
        // Fees are whole rupees only: fractional amounts create pending
        // balances that the receipt screen can never clear.
        if yearly[i].fract() != 0.0 || tuition[i].fract() != 0.0 || other[i].fract() != 0.0 {
            return Err("Fee amounts must be whole rupees (no decimals)".to_string());
        }
        if tuition[i] + other[i] != yearly[i] {
            return Err(format!(
                "Tuition fee and other fee must add up to year {} fee",
                i + 1
            ));
        }
    }
    Ok(StudentFees {
        yearly,
        tuition,
        other,
    })
}

/// Total amount paid (across all years) for a single fee type, ignoring
/// cancelled receipts. Receipts only carry a fee type, not a year, so the
/// invariant we protect is at the fee-type level.
async fn total_paid_for_fee_type(
    pool: &SqlitePool,
    student_id: &str,
    fee_type: &str,
) -> DbResult<f64> {
    sqlx::query_scalar(
        "SELECT CAST(COALESCE(SUM(amount_paid), 0) AS REAL) FROM receipts
         WHERE student_id = ? AND COALESCE(fee_type, 'Tuition') = ? AND cancelled = 0",
    )
    .bind(student_id)
    .bind(fee_type)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())
}

/// A fee type's total can never be lowered below what the student has already
/// paid towards it. Otherwise an edit that drops, say, tuition from 70000 to
/// 60000 after 70000 was collected would silently strip the 10000 surplus from
/// the books (pending clamps at zero, so the over-payment just vanishes).
async fn ensure_fees_cover_payments(
    pool: &SqlitePool,
    student_id: &str,
    requested: &StudentFees,
) -> DbResult<()> {
    for (fee_type, requested_total) in [
        ("Tuition", requested.tuition.iter().sum::<f64>()),
        ("Other", requested.other.iter().sum::<f64>()),
    ] {
        let paid = total_paid_for_fee_type(pool, student_id, fee_type).await?;
        if requested_total + 0.01 < paid {
            return Err(format!(
                "Total {fee_type} fee ({requested_total:.0}) cannot be less than the {paid:.0} already paid for it. Cancel a receipt first if a payment was wrong."
            ));
        }
    }
    Ok(())
}

fn ensure_passed_year_fees_unchanged(
    existing: &Student,
    requested: &StudentFees,
    requested_period: i64,
) -> DbResult<()> {
    if existing.admission_cancelled {
        return Ok(());
    }

    let existing_year = current_course_year_from_period(existing.current_course_period);
    let requested_year = current_course_year_from_period(requested_period);
    let completed_years = existing_year.max(requested_year).saturating_sub(1);
    if completed_years == 0 {
        return Ok(());
    }

    let stored = existing_student_fees(existing);
    let locked_years = completed_years.min(4) as usize;
    for year in 1..=locked_years {
        let index = year - 1;
        if stored.yearly[index] != requested.yearly[index]
            || stored.tuition[index] != requested.tuition[index]
            || stored.other[index] != requested.other[index]
        {
            return Err(format!(
                "Year {year} fee cannot be changed after the student has passed that year"
            ));
        }
    }

    Ok(())
}

pub async fn create_student(
    pool: &SqlitePool,
    req: StudentRequest,
    created_by: &str,
) -> DbResult<Student> {
    validate_date(&req.admission_date, "Admission date")?;
    let course = load_course(pool, &req.course_id).await?;
    if course.branch_id != req.branch_id {
        return Err("Course does not belong to the selected branch".to_string());
    }
    let fees = normalize_student_fees(&req)?;
    let month = start_month(pool).await?;
    let year = academic_year(&req.admission_date, month)?;
    // The document number is composed once here and stored permanently; later
    // branch-code changes never rewrite already-issued numbers.
    let bcode = branch_code(pool, &req.branch_id).await?;
    let now = now_rfc3339();
    let id = new_id();

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let seq = next_seq(&mut tx, &req.branch_id, "form", year).await?;
    let form_no = compose_form_no(&bcode, seq, year);
    sqlx::query(
        "INSERT INTO students (id, form_seq, form_year, form_no, admission_date, branch_id, course_id, student_name, surname, father_name, category, religion, caste, gender, aadhar, address, district, taluka, pincode, student_phone, parent_phone, photo,
            fee_year_1, fee_year_2, fee_year_3, fee_year_4, tuition_fee_year_1, tuition_fee_year_2, tuition_fee_year_3, tuition_fee_year_4, other_fee_year_1, other_fee_year_2, other_fee_year_3, other_fee_year_4,
            current_course_period, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
    )
    .bind(&id)
    .bind(seq)
    .bind(year)
    .bind(&form_no)
    .bind(&req.admission_date)
    .bind(&req.branch_id)
    .bind(&req.course_id)
    .bind(req.student_name.trim())
    .bind(req.surname.trim())
    .bind(req.father_name.trim())
    .bind(&req.category)
    .bind(&req.religion)
    .bind(&req.caste)
    .bind(&req.gender)
    .bind(&req.aadhar)
    .bind(req.address.trim())
    .bind(req.district.trim())
    .bind(req.taluka.trim())
    .bind(req.pincode.trim())
    .bind(req.student_phone.trim())
    .bind(req.parent_phone.trim())
    .bind(req.photo.trim())
    .bind(fees.yearly[0])
    .bind(fees.yearly[1])
    .bind(fees.yearly[2])
    .bind(fees.yearly[3])
    .bind(fees.tuition[0])
    .bind(fees.tuition[1])
    .bind(fees.tuition[2])
    .bind(fees.tuition[3])
    .bind(fees.other[0])
    .bind(fees.other[1])
    .bind(fees.other[2])
    .bind(fees.other[3])
    .bind(created_by)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(friendly_db_error)?;
    tx.commit().await.map_err(|e| e.to_string())?;

    load_student(pool, &id).await
}

pub async fn update_student(pool: &SqlitePool, id: &str, req: StudentRequest) -> DbResult<Student> {
    validate_date(&req.admission_date, "Admission date")?;
    let existing = load_student(pool, id).await?;
    // Branch moves are not allowed: the student's form number, sequence slot,
    // and receipts all belong to the admitting branch. Re-admit at the other
    // branch instead.
    if existing.branch_id != req.branch_id {
        return Err("Students cannot be moved to another branch".to_string());
    }
    // A student may stay on an archived course (their enrollment is history),
    // but cannot be moved onto one.
    let course = load_course_any(pool, &req.course_id).await?;
    if !course.active && course.id != existing.course_id {
        return Err("Cannot move a student to an archived course".to_string());
    }
    if course.branch_id != req.branch_id {
        return Err("Course does not belong to the student's branch".to_string());
    }
    let mut fees = normalize_student_fees(&req)?;
    if existing.admission_cancelled {
        fees = StudentFees::zero();
    }
    let period = normalize_current_course_period(
        req.current_course_period
            .unwrap_or(existing.current_course_period),
        &course,
    )?;
    ensure_passed_year_fees_unchanged(&existing, &fees, period)?;
    if !existing.admission_cancelled {
        ensure_fees_cover_payments(pool, id, &fees).await?;
    }

    // Form numbering is assigned once at admission and never changes on edit.
    sqlx::query(
        "UPDATE students SET admission_date = ?, course_id = ?, current_course_period = ?,
            student_name = ?, surname = ?, father_name = ?, category = ?, religion = ?, caste = ?, gender = ?, aadhar = ?, address = ?, district = ?, taluka = ?, pincode = ?, student_phone = ?, parent_phone = ?, photo = ?,
            fee_year_1 = ?, fee_year_2 = ?, fee_year_3 = ?, fee_year_4 = ?, tuition_fee_year_1 = ?, tuition_fee_year_2 = ?, tuition_fee_year_3 = ?, tuition_fee_year_4 = ?,
            other_fee_year_1 = ?, other_fee_year_2 = ?, other_fee_year_3 = ?, other_fee_year_4 = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&req.admission_date)
    .bind(&req.course_id)
    .bind(period)
    .bind(req.student_name.trim())
    .bind(req.surname.trim())
    .bind(req.father_name.trim())
    .bind(&req.category)
    .bind(&req.religion)
    .bind(&req.caste)
    .bind(&req.gender)
    .bind(&req.aadhar)
    .bind(req.address.trim())
    .bind(req.district.trim())
    .bind(req.taluka.trim())
    .bind(req.pincode.trim())
    .bind(req.student_phone.trim())
    .bind(req.parent_phone.trim())
    .bind(req.photo.trim())
    .bind(fees.yearly[0])
    .bind(fees.yearly[1])
    .bind(fees.yearly[2])
    .bind(fees.yearly[3])
    .bind(fees.tuition[0])
    .bind(fees.tuition[1])
    .bind(fees.tuition[2])
    .bind(fees.tuition[3])
    .bind(fees.other[0])
    .bind(fees.other[1])
    .bind(fees.other[2])
    .bind(fees.other[3])
    .bind(now_rfc3339())
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    load_student(pool, id).await
}

pub async fn cancel_student(pool: &SqlitePool, id: &str, by_user: &str) -> DbResult<Student> {
    let existing = load_student(pool, id).await?;
    if existing.admission_cancelled {
        return Ok(existing);
    }
    sqlx::query(
        "UPDATE students SET admission_cancelled = 1, admission_cancelled_at = ?, admission_cancelled_by = ?,
            fee_year_1 = 0, fee_year_2 = 0, fee_year_3 = 0, fee_year_4 = 0,
            tuition_fee_year_1 = 0, tuition_fee_year_2 = 0, tuition_fee_year_3 = 0, tuition_fee_year_4 = 0,
            other_fee_year_1 = 0, other_fee_year_2 = 0, other_fee_year_3 = 0, other_fee_year_4 = 0,
            updated_at = ?
         WHERE id = ?",
    )
    .bind(now_rfc3339())
    .bind(by_user)
    .bind(now_rfc3339())
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    load_student(pool, id).await
}

pub async fn promote_students(pool: &SqlitePool, req: PromoteRequest) -> DbResult<PromoteResponse> {
    if req.student_ids.is_empty() {
        return Err("Select at least one student to promote".to_string());
    }
    if !(1900..=2200).contains(&req.admission_year) {
        return Err("Invalid admission year".to_string());
    }
    // Archived courses still have enrolled students who must remain promotable.
    let course = load_course_any(pool, &req.course_id).await?;
    let max_period = total_course_periods(course.duration, &course.duration_type);

    // De-duplicate the requested ids while preserving order.
    let mut seen = std::collections::HashSet::new();
    let ids: Vec<String> = req
        .student_ids
        .into_iter()
        .filter(|id| seen.insert(id.clone()))
        .collect();

    let in_clause = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(", ");

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let count_sql = format!(
        "SELECT COUNT(*) FROM students
         WHERE id IN ({in_clause}) AND course_id = ? AND branch_id = ?
           AND CAST(strftime('%Y', admission_date) AS INTEGER) = ?
           AND admission_cancelled = 0"
    );
    let mut count_q = sqlx::query_scalar::<_, i64>(&count_sql);
    for id in &ids {
        count_q = count_q.bind(id);
    }
    let matching: i64 = count_q
        .bind(&course.id)
        .bind(&course.branch_id)
        .bind(req.admission_year)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if matching as usize != ids.len() {
        return Err(
            "Selected students do not match the chosen course and admission year".to_string(),
        );
    }

    let update_sql = format!(
        "UPDATE students
         SET current_course_period = MIN(current_course_period + 2, ?),
             updated_at = ?
         WHERE id IN ({in_clause}) AND current_course_period < ?"
    );
    let mut update_q = sqlx::query(&update_sql)
        .bind(max_period)
        .bind(now_rfc3339());
    for id in &ids {
        update_q = update_q.bind(id);
    }
    let promoted = update_q
        .bind(max_period)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .rows_affected() as usize;
    tx.commit().await.map_err(|e| e.to_string())?;

    let select_sql = student_select(&format!("WHERE s.id IN ({in_clause})"));
    let mut select_q = sqlx::query_as::<_, Student>(&select_sql);
    for id in &ids {
        select_q = select_q.bind(id);
    }
    let students = select_q.fetch_all(pool).await.map_err(|e| e.to_string())?;

    Ok(PromoteResponse {
        promoted_count: promoted,
        skipped_count: ids.len().saturating_sub(promoted),
        students,
    })
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

fn receipt_select(where_clause: &str) -> String {
    format!(
        "SELECT r.id,
         COALESCE(NULLIF(r.receipt_no, ''), b.code || '-' || r.receipt_seq) AS receipt_no,
         r.receipt_date, r.student_id, r.branch_id, COALESCE(r.fee_type, 'Tuition') AS fee_type,
         r.amount_paid, r.payment_mode, r.reference_no, r.cancelled, r.cancelled_at
         FROM receipts r
         JOIN branches b ON b.id = r.branch_id
         {where_clause}
         ORDER BY r.receipt_year DESC, r.receipt_seq DESC"
    )
}

pub async fn list_receipts(
    pool: &SqlitePool,
    branch_filter: Option<&str>,
    student_id: Option<&str>,
) -> DbResult<Vec<Receipt>> {
    let (sql, binds): (String, Vec<String>) = match (branch_filter, student_id) {
        (Some(b), Some(s)) => (
            receipt_select("WHERE r.branch_id = ? AND r.student_id = ?"),
            vec![b.to_string(), s.to_string()],
        ),
        (Some(b), None) => (receipt_select("WHERE r.branch_id = ?"), vec![b.to_string()]),
        (None, Some(s)) => (
            receipt_select("WHERE r.student_id = ?"),
            vec![s.to_string()],
        ),
        (None, None) => (receipt_select(""), vec![]),
    };
    let mut query = sqlx::query_as::<_, Receipt>(&sql);
    for b in binds {
        query = query.bind(b);
    }
    query.fetch_all(pool).await.map_err(|e| e.to_string())
}

/// Returns (branch_id, admission_cancelled) for a student.
pub async fn student_branch(pool: &SqlitePool, student_id: &str) -> DbResult<(String, bool)> {
    sqlx::query_as("SELECT branch_id, admission_cancelled FROM students WHERE id = ?")
        .bind(student_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Student not found".to_string())
}

/// The amount still owed by a student for one fee type, given everything that
/// is due through the current year. Used to reject overpayments server-side
/// (the frontend clamps too, but its receipt list can be stale).
async fn pending_for_fee_type(
    pool: &SqlitePool,
    student: &Student,
    fee_type: &str,
) -> DbResult<f64> {
    let paid: f64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE(SUM(amount_paid), 0) AS REAL) FROM receipts
         WHERE student_id = ? AND COALESCE(fee_type, 'Tuition') = ? AND cancelled = 0",
    )
    .bind(&student.id)
    .bind(fee_type)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let fees = if fee_type == "Other" {
        [
            student.other_fee_year_1,
            student.other_fee_year_2,
            student.other_fee_year_3,
            student.other_fee_year_4,
        ]
    } else {
        [
            student.tuition_fee_year_1,
            student.tuition_fee_year_2,
            student.tuition_fee_year_3,
            student.tuition_fee_year_4,
        ]
    };
    let breakdown = allocate_fee_by_year(
        fees,
        student.course_duration,
        &student.course_duration_type,
        billing_through_period(student),
        paid,
    );
    Ok(breakdown.iter().map(|b| b.pending).sum())
}

pub async fn create_receipt(
    pool: &SqlitePool,
    req: ReceiptRequest,
    branch_id: &str,
    created_by: &str,
) -> DbResult<Receipt> {
    validate_date(&req.receipt_date, "Receipt date")?;
    if req.amount_paid <= 0.0 {
        return Err("Amount paid is required".to_string());
    }
    if req.amount_paid.fract() != 0.0 {
        return Err("Amount paid must be whole rupees (no decimals)".to_string());
    }
    if !["Tuition", "Other"].contains(&req.fee_type.as_str()) {
        return Err("Invalid fee type".to_string());
    }
    if !["Cash", "UPI", "DD", "Cheque", "NEFT", "RTGS"].contains(&req.payment_mode.as_str()) {
        return Err("Invalid payment mode".to_string());
    }
    // Trim the reference so a whitespace-only entry doesn't satisfy the
    // non-cash requirement (or get stored).
    let reference_no = req
        .reference_no
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    if req.payment_mode != "Cash" && reference_no.is_none() {
        return Err("Reference number is required for this payment mode".to_string());
    }
    let student = load_student(pool, &req.student_id).await?;
    if student.branch_id != branch_id {
        return Err("Receipt branch must match the student's branch".to_string());
    }
    let pending = pending_for_fee_type(pool, &student, &req.fee_type).await?;
    if req.amount_paid > pending + 0.01 {
        return Err(format!(
            "Amount paid ({:.2}) exceeds the pending {} fee ({:.2})",
            req.amount_paid, req.fee_type, pending
        ));
    }
    let month = start_month(pool).await?;
    let year = academic_year(&req.receipt_date, month)?;
    let bcode = branch_code(pool, branch_id).await?;
    let now = now_rfc3339();
    let id = new_id();

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let seq = next_seq(
        &mut tx,
        branch_id,
        "receipt",
        sequence_year("receipt", year),
    )
    .await?;
    let receipt_no = compose_receipt_no(&bcode, seq);
    sqlx::query(
        "INSERT INTO receipts (id, receipt_seq, receipt_year, receipt_no, receipt_date, student_id, branch_id, fee_type, amount_paid, payment_mode, reference_no, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(seq)
    .bind(year)
    .bind(&receipt_no)
    .bind(&req.receipt_date)
    .bind(&req.student_id)
    .bind(branch_id)
    .bind(&req.fee_type)
    .bind(req.amount_paid)
    .bind(&req.payment_mode)
    .bind(reference_no)
    .bind(created_by)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(friendly_db_error)?;
    tx.commit().await.map_err(|e| e.to_string())?;

    load_receipt(pool, &id).await
}

async fn load_receipt(pool: &SqlitePool, id: &str) -> DbResult<Receipt> {
    sqlx::query_as::<_, Receipt>(&receipt_select("WHERE r.id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Receipt not found".to_string())
}

/// Void a mistaken receipt. The receipt keeps its number (numbers are frozen
/// and sequential) but stops counting towards the student's paid total. This
/// is the correction flow for wrong amounts or wrongly selected students:
/// cancel the receipt, then record a fresh one.
pub async fn cancel_receipt(pool: &SqlitePool, id: &str, by_user: &str) -> DbResult<Receipt> {
    let existing = load_receipt(pool, id).await?;
    if existing.cancelled {
        return Ok(existing);
    }
    sqlx::query(
        "UPDATE receipts SET cancelled = 1, cancelled_at = ?, cancelled_by = ?, updated_at = ? WHERE id = ?",
    )
    .bind(now_rfc3339())
    .bind(by_user)
    .bind(now_rfc3339())
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    load_receipt(pool, id).await
}

// ---------------------------------------------------------------------------
// Outstanding report (pure logic ported verbatim from the original API)
// ---------------------------------------------------------------------------

fn total_course_years(duration: i64, duration_type: &str) -> i64 {
    let years = if duration_type == "semester" {
        (duration + 1) / 2
    } else {
        duration
    };
    years.clamp(1, 4)
}

fn total_course_periods(duration: i64, duration_type: &str) -> i64 {
    if duration_type == "semester" {
        duration.clamp(1, 8)
    } else {
        total_course_years(duration, duration_type) * 2
    }
}

fn clamp_current_period(student: &Student) -> i64 {
    student.current_course_period.clamp(
        1,
        total_course_periods(student.course_duration, &student.course_duration_type),
    )
}

fn billing_through_period(student: &Student) -> i64 {
    let current_year = current_course_year_from_period(clamp_current_period(student));
    (current_year * 2).min(total_course_periods(
        student.course_duration,
        &student.course_duration_type,
    ))
}

fn current_period_label(student: &Student) -> String {
    let current_year = current_course_year_from_period(clamp_current_period(student));
    let end = billing_through_period(student);
    let start = ((current_year - 1) * 2 + 1).min(end);
    if student.course_duration_type == "semester" {
        format!("Year {current_year} (Semesters {start}-{end})")
    } else {
        format!("Year {current_year} (Terms {start}-{end})")
    }
}

fn normalize_current_course_period(period: i64, course: &Course) -> DbResult<i64> {
    let max_period = total_course_periods(course.duration, &course.duration_type);
    if period < 1 || period > max_period {
        return Err(format!("Current period must be between 1 and {max_period}"));
    }
    Ok(period)
}

fn current_course_year_from_period(period: i64) -> i64 {
    ((period + 1) / 2).max(1)
}

fn fee_breakdown(due: f64, paid: f64) -> OutstandingFeeBreakdown {
    OutstandingFeeBreakdown {
        due,
        paid,
        pending: (due - paid).max(0.0),
    }
}

fn allocate_fee_by_year(
    yearly_fees: [f64; 4],
    course_duration: i64,
    duration_type: &str,
    current_period: i64,
    mut paid: f64,
) -> Vec<OutstandingFeeBreakdown> {
    let total_years = total_course_years(course_duration, duration_type) as usize;
    let total_periods = total_course_periods(course_duration, duration_type) as usize;
    let due_periods = (current_period as usize).min(total_periods).max(1);
    let mut due_by_year = [0.0; 4];
    let mut paid_by_year = [0.0; 4];

    for period_index in 0..due_periods {
        let year_index = period_index / 2;
        let period_due = yearly_fees[year_index] / 2.0;
        let period_paid = paid.min(period_due);
        paid -= period_paid;
        due_by_year[year_index] += period_due;
        paid_by_year[year_index] += period_paid;
    }

    (0..total_years)
        .map(|i| fee_breakdown(due_by_year[i], paid_by_year[i]))
        .collect()
}

fn outstanding_year_breakdown(
    student: &Student,
    tuition_paid: f64,
    other_paid: f64,
) -> Vec<OutstandingYearBreakdown> {
    let current_period = billing_through_period(student);
    let tuition = allocate_fee_by_year(
        [
            student.tuition_fee_year_1,
            student.tuition_fee_year_2,
            student.tuition_fee_year_3,
            student.tuition_fee_year_4,
        ],
        student.course_duration,
        &student.course_duration_type,
        current_period,
        tuition_paid,
    );
    let other = allocate_fee_by_year(
        [
            student.other_fee_year_1,
            student.other_fee_year_2,
            student.other_fee_year_3,
            student.other_fee_year_4,
        ],
        student.course_duration,
        &student.course_duration_type,
        current_period,
        other_paid,
    );
    let total_years = total_course_years(student.course_duration, &student.course_duration_type);

    (0..total_years as usize)
        .map(|i| {
            let t = &tuition[i];
            let o = &other[i];
            OutstandingYearBreakdown {
                year: i as i32 + 1,
                total_due: t.due + o.due,
                total_paid: t.paid + o.paid,
                pending: t.pending + o.pending,
                tuition: fee_breakdown(t.due, t.paid),
                other: fee_breakdown(o.due, o.paid),
            }
        })
        .collect()
}

pub async fn outstanding(
    pool: &SqlitePool,
    branch_filter: Option<&str>,
) -> DbResult<Vec<OutstandingRow>> {
    let students = list_students(pool, branch_filter, false).await?;

    // Paid totals per student and fee type, in one pass, scoped to the branch
    // filter so a branch user's report doesn't scan every branch's receipts.
    // Cancelled receipts don't count towards paid totals.
    let paid_sql = format!(
        "SELECT student_id, COALESCE(fee_type, 'Tuition') AS fee_type, CAST(COALESCE(SUM(amount_paid), 0) AS REAL) AS total_paid
         FROM receipts WHERE cancelled = 0{}
         GROUP BY student_id, COALESCE(fee_type, 'Tuition')",
        if branch_filter.is_some() { " AND branch_id = ?" } else { "" }
    );
    let mut paid_q = sqlx::query_as::<_, (String, String, f64)>(&paid_sql);
    if let Some(bid) = branch_filter {
        paid_q = paid_q.bind(bid.to_string());
    }
    let paid_rows = paid_q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    let mut paid_by_student: HashMap<(String, String), f64> = HashMap::new();
    for (student_id, fee_type, total) in paid_rows {
        paid_by_student.insert((student_id, fee_type), total);
    }

    // Latest receipt number per student: ascending order means the last insert
    // per student wins.
    let last_sql = format!(
        "SELECT r.student_id,
         COALESCE(NULLIF(r.receipt_no, ''), b.code || '-' || r.receipt_seq) AS receipt_no
         FROM receipts r JOIN branches b ON b.id = r.branch_id
         WHERE r.cancelled = 0{}
         ORDER BY r.receipt_year ASC, r.receipt_seq ASC",
        if branch_filter.is_some() {
            " AND r.branch_id = ?"
        } else {
            ""
        }
    );
    let mut last_q = sqlx::query_as::<_, (String, String)>(&last_sql);
    if let Some(bid) = branch_filter {
        last_q = last_q.bind(bid.to_string());
    }
    let last_rows = last_q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    let mut last_receipt_by_student: HashMap<String, String> = HashMap::new();
    for (student_id, receipt_no) in last_rows {
        last_receipt_by_student.insert(student_id, receipt_no);
    }

    let mut rows = Vec::new();
    for student in students {
        let tuition_paid = paid_by_student
            .get(&(student.id.clone(), "Tuition".to_string()))
            .copied()
            .unwrap_or(0.0);
        let other_paid = paid_by_student
            .get(&(student.id.clone(), "Other".to_string()))
            .copied()
            .unwrap_or(0.0);
        let year_breakdown = outstanding_year_breakdown(&student, tuition_paid, other_paid);
        let total_due: f64 = year_breakdown.iter().map(|r| r.total_due).sum();
        let total_paid: f64 = year_breakdown.iter().map(|r| r.total_paid).sum();
        let pending: f64 = year_breakdown.iter().map(|r| r.pending).sum();
        if pending > 0.0 {
            rows.push(OutstandingRow {
                current_period: current_period_label(&student),
                last_receipt_no: last_receipt_by_student.get(&student.id).cloned(),
                student,
                total_due,
                total_paid,
                pending,
                year_breakdown,
            });
        }
    }
    Ok(rows)
}

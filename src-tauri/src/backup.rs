//! Backup, restore, and local snapshot logic.
//!
//! A `.gewtbak` file is a plain (unencrypted) JSON document. It carries:
//!   - a config snapshot (academic settings + the included branches),
//!   - the relevant login accounts (admin + employees of the included branches),
//!   - the branch-scoped business data (courses, students, receipts, sequences).
//!
//! Import is **branch-partitioned**: business data for each branch contained in
//! the file fully replaces that branch's data locally; other branches are left
//! untouched. Config and accounts are applied newest-wins (by `updated_at`), so
//! the admin master — the only place config can change — always wins.

use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use sqlx::FromRow;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub type BackupResult<T> = Result<T, String>;

const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
struct RawBranch {
    id: String,
    code: String,
    name: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
struct RawUser {
    id: String,
    user_id: String,
    name: String,
    password_hash: String,
    role: String,
    branch_id: Option<String>,
    active: i64,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
struct RawCourse {
    id: String,
    branch_id: String,
    name: String,
    duration: i64,
    duration_type: String,
    letterhead: Option<String>,
    active: i64,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
struct RawStudent {
    id: String,
    form_seq: i64,
    form_year: i64,
    // Introduced after the first release; older backup files won't carry these,
    // so they default to empty and are backfilled after import.
    #[serde(default)]
    form_no: String,
    admission_date: String,
    branch_id: String,
    course_id: String,
    student_name: String,
    #[serde(default)]
    surname: String,
    #[serde(default)]
    father_name: String,
    category: String,
    religion: String,
    caste: String,
    gender: String,
    aadhar: String,
    address: String,
    student_phone: String,
    parent_phone: String,
    fee_year_1: f64,
    fee_year_2: f64,
    fee_year_3: f64,
    fee_year_4: f64,
    tuition_fee_year_1: f64,
    tuition_fee_year_2: f64,
    tuition_fee_year_3: f64,
    tuition_fee_year_4: f64,
    other_fee_year_1: f64,
    other_fee_year_2: f64,
    other_fee_year_3: f64,
    other_fee_year_4: f64,
    current_course_year: i64,
    current_course_period: i64,
    admission_cancelled: i64,
    admission_cancelled_at: Option<String>,
    admission_cancelled_by: Option<String>,
    created_by: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
struct RawReceipt {
    id: String,
    receipt_seq: i64,
    receipt_year: i64,
    #[serde(default)]
    receipt_no: String,
    receipt_date: String,
    student_id: String,
    branch_id: String,
    fee_type: String,
    amount_paid: f64,
    payment_mode: String,
    reference_no: Option<String>,
    // Receipt cancellation was introduced after the first release; older
    // backup files won't carry these fields.
    #[serde(default)]
    cancelled: i64,
    #[serde(default)]
    cancelled_at: Option<String>,
    #[serde(default)]
    cancelled_by: Option<String>,
    created_by: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
struct RawSequence {
    branch_id: String,
    doc_type: String,
    academic_year: i64,
    last_value: i64,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
struct RawSettings {
    academic_year_start_month: i64,
    form_type_code: String,
    receipt_type_code: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ConfigSnapshot {
    academic_settings: RawSettings,
    branches: Vec<RawBranch>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupData {
    courses: Vec<RawCourse>,
    students: Vec<RawStudent>,
    receipts: Vec<RawReceipt>,
    number_sequences: Vec<RawSequence>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Backup {
    schema_version: i64,
    exported_at: String,
    origin_role: String,
    branch_ids: Vec<String>,
    config: ConfigSnapshot,
    accounts: Vec<RawUser>,
    data: BackupData,
}

#[derive(Debug, Serialize)]
pub struct ImportSummary {
    pub branches: Vec<String>,
    pub students: usize,
    pub receipts: usize,
    pub courses: usize,
}

fn placeholders(n: usize) -> String {
    std::iter::repeat("?")
        .take(n)
        .collect::<Vec<_>>()
        .join(", ")
}

/// Export the given branches to a `.gewtbak` file at `dest`.
pub async fn export_backup(
    pool: &SqlitePool,
    branch_ids: &[String],
    origin_role: &str,
    dest: &Path,
) -> BackupResult<()> {
    if branch_ids.is_empty() {
        return Err("Select at least one branch to back up".to_string());
    }
    let in_clause = placeholders(branch_ids.len());

    let settings: RawSettings = sqlx::query_as(
        "SELECT academic_year_start_month, form_type_code, receipt_type_code, updated_at FROM academic_settings WHERE id = 1",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let branch_sql =
        format!("SELECT id, code, name, updated_at FROM branches WHERE id IN ({in_clause})");
    let mut branch_q = sqlx::query_as::<_, RawBranch>(&branch_sql);
    for id in branch_ids {
        branch_q = branch_q.bind(id);
    }
    let branches = branch_q.fetch_all(pool).await.map_err(|e| e.to_string())?;

    // Accounts: admin exports carry all admins + employees of the included
    // branches. Employee exports carry only those employees — handing a branch
    // user a file full of admin password hashes would invite offline cracking.
    let acct_sql = if origin_role == "admin" {
        format!(
            "SELECT id, user_id, name, password_hash, role, branch_id, active, updated_at
             FROM users WHERE role = 'admin' OR branch_id IN ({in_clause})"
        )
    } else {
        format!(
            "SELECT id, user_id, name, password_hash, role, branch_id, active, updated_at
             FROM users WHERE role = 'employee' AND branch_id IN ({in_clause})"
        )
    };
    let mut acct_q = sqlx::query_as::<_, RawUser>(&acct_sql);
    for id in branch_ids {
        acct_q = acct_q.bind(id);
    }
    let accounts = acct_q.fetch_all(pool).await.map_err(|e| e.to_string())?;

    let courses = fetch_courses(pool, branch_ids, &in_clause).await?;
    let students = fetch_students(pool, branch_ids, &in_clause).await?;
    let receipts = fetch_receipts(pool, branch_ids, &in_clause).await?;
    let number_sequences = fetch_sequences(pool, branch_ids, &in_clause).await?;

    let backup = Backup {
        schema_version: SCHEMA_VERSION,
        exported_at: chrono::Utc::now().to_rfc3339(),
        origin_role: origin_role.to_string(),
        branch_ids: branch_ids.to_vec(),
        config: ConfigSnapshot {
            academic_settings: settings,
            branches,
        },
        accounts,
        data: BackupData {
            courses,
            students,
            receipts,
            number_sequences,
        },
    };

    let json = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(dest, json).map_err(|e| e.to_string())?;
    Ok(())
}

async fn fetch_courses(pool: &SqlitePool, ids: &[String], in_clause: &str) -> BackupResult<Vec<RawCourse>> {
    let sql = format!(
        "SELECT id, branch_id, name, duration, duration_type, letterhead, active, updated_at FROM courses WHERE branch_id IN ({in_clause})"
    );
    let mut q = sqlx::query_as::<_, RawCourse>(&sql);
    for id in ids {
        q = q.bind(id);
    }
    q.fetch_all(pool).await.map_err(|e| e.to_string())
}

async fn fetch_students(pool: &SqlitePool, ids: &[String], in_clause: &str) -> BackupResult<Vec<RawStudent>> {
    let sql = format!(
        "SELECT id, form_seq, form_year, form_no, admission_date, branch_id, course_id, student_name, surname, father_name, category, religion, caste, gender, aadhar, address, student_phone, parent_phone,
            fee_year_1, fee_year_2, fee_year_3, fee_year_4, tuition_fee_year_1, tuition_fee_year_2, tuition_fee_year_3, tuition_fee_year_4, other_fee_year_1, other_fee_year_2, other_fee_year_3, other_fee_year_4,
            current_course_year, current_course_period, admission_cancelled, admission_cancelled_at, admission_cancelled_by, created_by, created_at, updated_at
         FROM students WHERE branch_id IN ({in_clause})"
    );
    let mut q = sqlx::query_as::<_, RawStudent>(&sql);
    for id in ids {
        q = q.bind(id);
    }
    q.fetch_all(pool).await.map_err(|e| e.to_string())
}

async fn fetch_receipts(pool: &SqlitePool, ids: &[String], in_clause: &str) -> BackupResult<Vec<RawReceipt>> {
    let sql = format!(
        "SELECT id, receipt_seq, receipt_year, receipt_no, receipt_date, student_id, branch_id, fee_type, amount_paid, payment_mode, reference_no, cancelled, cancelled_at, cancelled_by, created_by, created_at, updated_at
         FROM receipts WHERE branch_id IN ({in_clause})"
    );
    let mut q = sqlx::query_as::<_, RawReceipt>(&sql);
    for id in ids {
        q = q.bind(id);
    }
    q.fetch_all(pool).await.map_err(|e| e.to_string())
}

async fn fetch_sequences(pool: &SqlitePool, ids: &[String], in_clause: &str) -> BackupResult<Vec<RawSequence>> {
    let sql = format!(
        "SELECT branch_id, doc_type, academic_year, last_value FROM number_sequences WHERE branch_id IN ({in_clause})"
    );
    let mut q = sqlx::query_as::<_, RawSequence>(&sql);
    for id in ids {
        q = q.bind(id);
    }
    q.fetch_all(pool).await.map_err(|e| e.to_string())
}

/// Import a `.gewtbak` file. `restrict_branch` limits a branch user to importing
/// only their own branch's file (None = admin, no restriction).
pub async fn import_backup(
    pool: &SqlitePool,
    src: &Path,
    restrict_branch: Option<&str>,
) -> BackupResult<ImportSummary> {
    let bytes = std::fs::read(src).map_err(|e| format!("Could not read backup file: {e}"))?;
    let backup: Backup =
        serde_json::from_slice(&bytes).map_err(|_| "This is not a valid GEWT backup file".to_string())?;
    if backup.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "Backup version {} is not supported by this app",
            backup.schema_version
        ));
    }
    if let Some(branch) = restrict_branch {
        if backup.branch_ids.iter().any(|b| b != branch) || backup.branch_ids.is_empty() {
            return Err("You can only import a backup for your own branch".to_string());
        }
    }

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Config and accounts only flow through admin imports. A branch-restricted
    // (employee) import applies business data only — otherwise a hand-crafted
    // backup file could overwrite the admin password hash or global settings.
    let apply_config_and_accounts = restrict_branch.is_none();

    // 1. Config: branches (newest-wins per row).
    for b in backup.config.branches.iter().filter(|_| apply_config_and_accounts) {
        let local: Option<String> =
            sqlx::query_scalar("SELECT updated_at FROM branches WHERE id = ?")
                .bind(&b.id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        if local.as_deref().map(|l| b.updated_at.as_str() > l).unwrap_or(true) {
            sqlx::query(
                "INSERT INTO branches (id, code, name, updated_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT (id) DO UPDATE SET code = excluded.code, name = excluded.name, updated_at = excluded.updated_at",
            )
            .bind(&b.id)
            .bind(&b.code)
            .bind(&b.name)
            .bind(&b.updated_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    // 2. Config: academic settings (newest-wins).
    let local_settings: Option<String> =
        sqlx::query_scalar("SELECT updated_at FROM academic_settings WHERE id = 1")
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    let s = &backup.config.academic_settings;
    if apply_config_and_accounts
        && local_settings
            .as_deref()
            .map(|l| s.updated_at.as_str() > l)
            .unwrap_or(true)
    {
        sqlx::query(
            "UPDATE academic_settings SET academic_year_start_month = ?, form_type_code = ?, receipt_type_code = ?, updated_at = ? WHERE id = 1",
        )
        .bind(s.academic_year_start_month)
        .bind(&s.form_type_code)
        .bind(&s.receipt_type_code)
        .bind(&s.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    // 3. Accounts (newest-wins per id).
    for u in backup.accounts.iter().filter(|_| apply_config_and_accounts) {
        let local: Option<String> = sqlx::query_scalar("SELECT updated_at FROM users WHERE id = ?")
            .bind(&u.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        if local.as_deref().map(|l| u.updated_at.as_str() > l).unwrap_or(true) {
            sqlx::query(
                "INSERT INTO users (id, user_id, name, password_hash, role, branch_id, active, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id, name = excluded.name, password_hash = excluded.password_hash,
                    role = excluded.role, branch_id = excluded.branch_id, active = excluded.active, updated_at = excluded.updated_at",
            )
            .bind(&u.id)
            .bind(&u.user_id)
            .bind(&u.name)
            .bind(&u.password_hash)
            .bind(&u.role)
            .bind(&u.branch_id)
            .bind(u.active)
            .bind(&u.updated_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    // 4. Branch-partitioned replace of business data.
    for branch_id in &backup.branch_ids {
        for table in ["receipts", "students", "courses", "number_sequences"] {
            sqlx::query(&format!("DELETE FROM {table} WHERE branch_id = ?"))
                .bind(branch_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    for c in &backup.data.courses {
        sqlx::query(
            "INSERT INTO courses (id, branch_id, name, duration, duration_type, letterhead, active, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&c.id)
        .bind(&c.branch_id)
        .bind(&c.name)
        .bind(c.duration)
        .bind(&c.duration_type)
        .bind(&c.letterhead)
        .bind(c.active)
        .bind(&c.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    for s in &backup.data.students {
        sqlx::query(
            "INSERT INTO students (id, form_seq, form_year, form_no, admission_date, branch_id, course_id, student_name, surname, father_name, category, religion, caste, gender, aadhar, address, student_phone, parent_phone,
                fee_year_1, fee_year_2, fee_year_3, fee_year_4, tuition_fee_year_1, tuition_fee_year_2, tuition_fee_year_3, tuition_fee_year_4, other_fee_year_1, other_fee_year_2, other_fee_year_3, other_fee_year_4,
                current_course_year, current_course_period, admission_cancelled, admission_cancelled_at, admission_cancelled_by, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&s.id).bind(s.form_seq).bind(s.form_year).bind(&s.form_no).bind(&s.admission_date).bind(&s.branch_id).bind(&s.course_id)
        .bind(&s.student_name).bind(&s.surname).bind(&s.father_name).bind(&s.category).bind(&s.religion).bind(&s.caste).bind(&s.gender).bind(&s.aadhar).bind(&s.address).bind(&s.student_phone).bind(&s.parent_phone)
        .bind(s.fee_year_1).bind(s.fee_year_2).bind(s.fee_year_3).bind(s.fee_year_4)
        .bind(s.tuition_fee_year_1).bind(s.tuition_fee_year_2).bind(s.tuition_fee_year_3).bind(s.tuition_fee_year_4)
        .bind(s.other_fee_year_1).bind(s.other_fee_year_2).bind(s.other_fee_year_3).bind(s.other_fee_year_4)
        .bind(s.current_course_year).bind(s.current_course_period).bind(s.admission_cancelled).bind(&s.admission_cancelled_at).bind(&s.admission_cancelled_by)
        .bind(&s.created_by).bind(&s.created_at).bind(&s.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    for r in &backup.data.receipts {
        sqlx::query(
            "INSERT INTO receipts (id, receipt_seq, receipt_year, receipt_no, receipt_date, student_id, branch_id, fee_type, amount_paid, payment_mode, reference_no, cancelled, cancelled_at, cancelled_by, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&r.id).bind(r.receipt_seq).bind(r.receipt_year).bind(&r.receipt_no).bind(&r.receipt_date).bind(&r.student_id).bind(&r.branch_id)
        .bind(&r.fee_type).bind(r.amount_paid).bind(&r.payment_mode).bind(&r.reference_no)
        .bind(r.cancelled).bind(&r.cancelled_at).bind(&r.cancelled_by)
        .bind(&r.created_by).bind(&r.created_at).bind(&r.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    for seq in &backup.data.number_sequences {
        sqlx::query(
            "INSERT INTO number_sequences (branch_id, doc_type, academic_year, last_value) VALUES (?, ?, ?, ?)",
        )
        .bind(&seq.branch_id)
        .bind(&seq.doc_type)
        .bind(seq.academic_year)
        .bind(seq.last_value)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    // Rows from pre-freeze backup files arrive with empty document numbers;
    // compose them once so they're frozen from here on.
    crate::db::backfill_document_numbers(pool).await?;

    Ok(ImportSummary {
        branches: backup.branch_ids,
        students: backup.data.students.len(),
        receipts: backup.data.receipts.len(),
        courses: backup.data.courses.len(),
    })
}

// ---------------------------------------------------------------------------
// Local safety snapshots (raw DB copies in app_data_dir/backups)
// ---------------------------------------------------------------------------

/// Always keep this many of the newest snapshots, whatever day they're from —
/// so a manual "snapshot before a risky change" survives a few app restarts.
const KEEP_RECENT_SNAPSHOTS: usize = 5;
/// Additionally keep the newest snapshot of each of this many distinct days,
/// so closing the app many times in one day can't wipe older restore points.
const KEEP_SNAPSHOT_DAYS: usize = 10;

pub fn backups_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("backups")
}

/// Remove stale `*.db.restoring` staging files left behind if the app crashed
/// in the middle of a snapshot restore.
pub fn cleanup_staging(dir: &Path) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        let path = entry.path();
        let is_staging = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.ends_with(".db.restoring"))
            .unwrap_or(false);
        if is_staging {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Checkpoint the WAL and copy the live DB file into the backups folder,
/// then prune old snapshots (see prune_snapshots for the retention rules).
pub async fn create_snapshot(pool: &SqlitePool, db_path: &Path, dir: &Path) -> BackupResult<PathBuf> {
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dest = dir.join(format!("gewt-{stamp}.db"));
    std::fs::copy(db_path, &dest).map_err(|e| e.to_string())?;
    prune_snapshots(dir);
    Ok(dest)
}

/// Retention: the KEEP_RECENT_SNAPSHOTS newest files, plus the newest snapshot
/// of each of the KEEP_SNAPSHOT_DAYS most recent days that have one. A snapshot
/// is taken on every app close, so a simple "keep newest N" would let one busy
/// day push every older day's restore point out of the window.
fn prune_snapshots(dir: &Path) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    // Filenames are gewt-YYYYMMDD-HHMMSS.db, so a lexical sort is also a
    // chronological sort. Newest first.
    let mut snaps: Vec<PathBuf> = read
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| is_snapshot_file(p))
        .collect();
    snaps.sort();
    snaps.reverse();

    let mut keep: std::collections::HashSet<PathBuf> = HashSet::new();
    let mut days_kept: Vec<String> = Vec::new();
    for (index, snap) in snaps.iter().enumerate() {
        if index < KEEP_RECENT_SNAPSHOTS {
            keep.insert(snap.clone());
        }
        // "gewt-YYYYMMDD" — the day prefix of the snapshot file name.
        let day = snap
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.chars().take(13).collect::<String>())
            .unwrap_or_default();
        if !days_kept.contains(&day) {
            if days_kept.len() < KEEP_SNAPSHOT_DAYS {
                days_kept.push(day);
                keep.insert(snap.clone());
            }
        }
    }
    for snap in &snaps {
        if !keep.contains(snap) {
            let _ = std::fs::remove_file(snap);
        }
    }
}

fn is_snapshot_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with("gewt-") && n.ends_with(".db"))
        .unwrap_or(false)
}

/// True if there is no snapshot newer than ~24h (used to snapshot on launch).
/// Only real snapshot files count — stray files like .DS_Store must not
/// suppress the daily snapshot.
pub fn needs_daily_snapshot(dir: &Path) -> bool {
    let Ok(read) = std::fs::read_dir(dir) else {
        return true;
    };
    let now = std::time::SystemTime::now();
    let day = std::time::Duration::from_secs(24 * 60 * 60);
    let mut newest: Option<std::time::SystemTime> = None;
    for entry in read.flatten() {
        if !is_snapshot_file(&entry.path()) {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if newest.map(|n| modified > n).unwrap_or(true) {
                    newest = Some(modified);
                }
            }
        }
    }
    match newest {
        Some(t) => now.duration_since(t).map(|d| d > day).unwrap_or(true),
        None => true,
    }
}

#[derive(Debug, Serialize)]
pub struct SnapshotEntry {
    pub file_name: String,
    pub path: String,
    pub modified_at: String,
}

/// The snapshots in the backups folder, newest first.
pub fn list_snapshots(dir: &Path) -> Vec<SnapshotEntry> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut entries: Vec<SnapshotEntry> = read
        .flatten()
        .filter(|e| is_snapshot_file(&e.path()))
        .filter_map(|e| {
            let modified: chrono::DateTime<chrono::Local> =
                e.metadata().ok()?.modified().ok()?.into();
            Some(SnapshotEntry {
                file_name: e.file_name().to_string_lossy().to_string(),
                path: e.path().display().to_string(),
                modified_at: modified.to_rfc3339(),
            })
        })
        .collect();
    entries.sort_by(|a, b| b.file_name.cmp(&a.file_name));
    entries
}

const RESTORE_TABLES: [&str; 7] = [
    "receipts",
    "students",
    "courses",
    "users",
    "number_sequences",
    "academic_settings",
    "branches",
];

/// Replace the live database content with a snapshot's. The copy happens
/// inside the live pool (ATTACH + per-table copy over shared columns), so the
/// open connections stay valid. Shared-column copy also tolerates snapshots
/// taken before a schema migration.
///
/// A safety snapshot of the current state is taken first. The target is copied
/// to a temp file before that, because the safety snapshot's pruning could
/// otherwise delete the very snapshot being restored.
pub async fn restore_snapshot(
    pool: &SqlitePool,
    db_path: &Path,
    dir: &Path,
    snapshot_path: &str,
) -> BackupResult<()> {
    let snapshot = PathBuf::from(snapshot_path);
    let in_backups_dir = snapshot
        .canonicalize()
        .ok()
        .zip(dir.canonicalize().ok())
        .map(|(file, dir)| file.starts_with(&dir))
        .unwrap_or(false);
    if !in_backups_dir || !is_snapshot_file(&snapshot) {
        return Err("Not a valid snapshot file".to_string());
    }

    let staging = snapshot.with_extension("db.restoring");
    std::fs::copy(&snapshot, &staging).map_err(|e| format!("Could not read snapshot: {e}"))?;
    let result = async {
        create_snapshot(pool, db_path, dir).await?;

        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        sqlx::query("ATTACH DATABASE ? AS snap")
            .bind(staging.display().to_string())
            .execute(&mut *conn)
            .await
            .map_err(|e| format!("Could not open snapshot: {e}"))?;
        let copied = restore_tables(&mut conn).await;
        // Always detach, even if the copy failed and rolled back.
        let _ = sqlx::query("DETACH DATABASE snap").execute(&mut *conn).await;
        copied
    }
    .await;
    let _ = std::fs::remove_file(&staging);
    result
}

async fn restore_tables(conn: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>) -> BackupResult<()> {
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut **conn)
        .await
        .map_err(|e| e.to_string())?;
    let result = async {
        sqlx::query("BEGIN").execute(&mut **conn).await.map_err(|e| e.to_string())?;
        for table in RESTORE_TABLES {
            // Copy only the columns both schemas share, so older snapshots
            // restore cleanly after migrations added columns.
            let live_cols: Vec<String> =
                sqlx::query_scalar(&format!("SELECT name FROM pragma_table_info('{table}')"))
                    .fetch_all(&mut **conn)
                    .await
                    .map_err(|e| e.to_string())?;
            let snap_cols: Vec<String> = sqlx::query_scalar(&format!(
                "SELECT name FROM snap.pragma_table_info('{table}')"
            ))
            .fetch_all(&mut **conn)
            .await
            .map_err(|e| e.to_string())?;
            let shared: Vec<String> = live_cols
                .into_iter()
                .filter(|c| snap_cols.contains(c))
                .collect();
            if shared.is_empty() {
                continue; // Table absent from the snapshot — leave live data.
            }
            let cols = shared.join(", ");
            sqlx::query(&format!("DELETE FROM {table}"))
                .execute(&mut **conn)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query(&format!(
                "INSERT INTO {table} ({cols}) SELECT {cols} FROM snap.{table}"
            ))
            .execute(&mut **conn)
            .await
            .map_err(|e| e.to_string())?;
        }
        sqlx::query("COMMIT").execute(&mut **conn).await.map_err(|e| e.to_string())?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = sqlx::query("ROLLBACK").execute(&mut **conn).await;
    }
    let _ = sqlx::query("PRAGMA foreign_keys = ON").execute(&mut **conn).await;
    result
}

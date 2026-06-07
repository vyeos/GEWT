use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::path::Path;
use std::str::FromStr;

pub async fn init_db(app_data_dir: &Path) -> Result<SqlitePool, sqlx::Error> {
    let db_path = app_data_dir.join("gewt-cache.db");
    let opts = SqliteConnectOptions::from_str(&format!("sqlite:{}?mode=rwc", db_path.display()))?
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(false);
    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(opts)
        .await?;
    create_tables(&pool).await?;
    Ok(pool)
}

async fn create_tables(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS courses (
            id TEXT PRIMARY KEY,
            branch_id TEXT NOT NULL,
            name TEXT NOT NULL,
            duration INTEGER NOT NULL,
            duration_type TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS students (
            id TEXT PRIMARY KEY,
            form_no TEXT NOT NULL,
            admission_date TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            branch_name TEXT NOT NULL,
            course_id TEXT NOT NULL,
            course_name TEXT NOT NULL,
            course_duration INTEGER NOT NULL,
            course_duration_type TEXT NOT NULL,
            student_name TEXT NOT NULL,
            category TEXT NOT NULL,
            religion TEXT NOT NULL,
            caste TEXT NOT NULL,
            gender TEXT NOT NULL,
            aadhar TEXT NOT NULL,
            address TEXT NOT NULL,
            student_phone TEXT NOT NULL,
            parent_phone TEXT NOT NULL,
            fee_year_1 REAL NOT NULL,
            fee_year_2 REAL NOT NULL,
            fee_year_3 REAL NOT NULL,
            fee_year_4 REAL NOT NULL,
            tuition_fee_year_1 REAL NOT NULL DEFAULT 0,
            tuition_fee_year_2 REAL NOT NULL DEFAULT 0,
            tuition_fee_year_3 REAL NOT NULL DEFAULT 0,
            tuition_fee_year_4 REAL NOT NULL DEFAULT 0,
            other_fee_year_1 REAL NOT NULL DEFAULT 0,
            other_fee_year_2 REAL NOT NULL DEFAULT 0,
            other_fee_year_3 REAL NOT NULL DEFAULT 0,
            other_fee_year_4 REAL NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;
    ensure_student_fee_split_columns(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS receipts (
            id TEXT PRIMARY KEY,
            receipt_no INTEGER NOT NULL,
            receipt_date TEXT NOT NULL,
            student_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            fee_type TEXT NOT NULL,
            amount_paid REAL NOT NULL,
            payment_mode TEXT NOT NULL,
            reference_no TEXT,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    let has_scoped_metadata: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('sync_metadata') WHERE name = 'scope_key'",
    )
    .fetch_one(pool)
    .await?;
    if has_scoped_metadata == 0 {
        sqlx::query("DROP TABLE IF EXISTS sync_metadata")
            .execute(pool)
            .await?;
    }

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS sync_metadata (
            table_name TEXT NOT NULL,
            scope_key TEXT NOT NULL,
            last_synced_at TEXT NOT NULL,
            record_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (table_name, scope_key)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_cache_courses_branch ON courses (branch_id)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_cache_students_branch ON students (branch_id)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_cache_receipts_student ON receipts (student_id)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_cache_receipts_branch ON receipts (branch_id)")
        .execute(pool)
        .await?;

    Ok(())
}

async fn ensure_student_fee_split_columns(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    for column in [
        "tuition_fee_year_1",
        "tuition_fee_year_2",
        "tuition_fee_year_3",
        "tuition_fee_year_4",
        "other_fee_year_1",
        "other_fee_year_2",
        "other_fee_year_3",
        "other_fee_year_4",
    ] {
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('students') WHERE name = $1",
        )
        .bind(column)
        .fetch_one(pool)
        .await?;
        if exists == 0 {
            sqlx::query(&format!(
                "ALTER TABLE students ADD COLUMN {column} REAL NOT NULL DEFAULT 0"
            ))
            .execute(pool)
            .await?;
        }
    }

    sqlx::query(
        "UPDATE students SET
            tuition_fee_year_1 = CASE WHEN tuition_fee_year_1 = 0 AND other_fee_year_1 = 0 THEN fee_year_1 ELSE tuition_fee_year_1 END,
            tuition_fee_year_2 = CASE WHEN tuition_fee_year_2 = 0 AND other_fee_year_2 = 0 THEN fee_year_2 ELSE tuition_fee_year_2 END,
            tuition_fee_year_3 = CASE WHEN tuition_fee_year_3 = 0 AND other_fee_year_3 = 0 THEN fee_year_3 ELSE tuition_fee_year_3 END,
            tuition_fee_year_4 = CASE WHEN tuition_fee_year_4 = 0 AND other_fee_year_4 = 0 THEN fee_year_4 ELSE tuition_fee_year_4 END",
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CachedCourse {
    pub id: String,
    pub branch_id: String,
    pub name: String,
    pub duration: i32,
    pub duration_type: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CachedStudent {
    pub id: String,
    pub form_no: String,
    pub admission_date: String,
    pub branch_id: String,
    pub branch_name: String,
    pub course_id: String,
    pub course_name: String,
    pub course_duration: i32,
    pub course_duration_type: String,
    pub student_name: String,
    pub category: String,
    pub religion: String,
    pub caste: String,
    pub gender: String,
    pub aadhar: String,
    pub address: String,
    pub student_phone: String,
    pub parent_phone: String,
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
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CachedReceipt {
    pub id: String,
    pub receipt_no: i64,
    pub receipt_date: String,
    pub student_id: String,
    pub branch_id: String,
    pub fee_type: String,
    pub amount_paid: f64,
    pub payment_mode: String,
    pub reference_no: Option<String>,
    pub updated_at: String,
}

pub async fn upsert_courses(
    pool: &SqlitePool,
    courses: &[CachedCourse],
) -> Result<(), sqlx::Error> {
    for c in courses {
        sqlx::query(
            "INSERT OR REPLACE INTO courses (id, branch_id, name, duration, duration_type, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(&c.id).bind(&c.branch_id).bind(&c.name).bind(c.duration)
        .bind(&c.duration_type).bind(&c.updated_at)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn upsert_students(
    pool: &SqlitePool,
    students: &[CachedStudent],
) -> Result<(), sqlx::Error> {
    for s in students {
        sqlx::query(
            "INSERT OR REPLACE INTO students (id, form_no, admission_date, branch_id, branch_name, course_id, course_name, course_duration, course_duration_type, student_name, category, religion, caste, gender, aadhar, address, student_phone, parent_phone, fee_year_1, fee_year_2, fee_year_3, fee_year_4, tuition_fee_year_1, tuition_fee_year_2, tuition_fee_year_3, tuition_fee_year_4, other_fee_year_1, other_fee_year_2, other_fee_year_3, other_fee_year_4, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)",
        )
        .bind(&s.id).bind(&s.form_no).bind(&s.admission_date).bind(&s.branch_id).bind(&s.branch_name)
        .bind(&s.course_id).bind(&s.course_name).bind(s.course_duration).bind(&s.course_duration_type)
        .bind(&s.student_name).bind(&s.category).bind(&s.religion).bind(&s.caste).bind(&s.gender)
        .bind(&s.aadhar).bind(&s.address).bind(&s.student_phone).bind(&s.parent_phone)
        .bind(s.fee_year_1).bind(s.fee_year_2).bind(s.fee_year_3).bind(s.fee_year_4)
        .bind(s.tuition_fee_year_1).bind(s.tuition_fee_year_2).bind(s.tuition_fee_year_3).bind(s.tuition_fee_year_4)
        .bind(s.other_fee_year_1).bind(s.other_fee_year_2).bind(s.other_fee_year_3).bind(s.other_fee_year_4)
        .bind(&s.updated_at)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn upsert_receipts(
    pool: &SqlitePool,
    receipts: &[CachedReceipt],
) -> Result<(), sqlx::Error> {
    for r in receipts {
        sqlx::query(
            "INSERT OR REPLACE INTO receipts (id, receipt_no, receipt_date, student_id, branch_id, fee_type, amount_paid, payment_mode, reference_no, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(&r.id).bind(r.receipt_no).bind(&r.receipt_date).bind(&r.student_id).bind(&r.branch_id)
        .bind(&r.fee_type).bind(r.amount_paid).bind(&r.payment_mode).bind(&r.reference_no)
        .bind(&r.updated_at)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn get_courses(
    pool: &SqlitePool,
    branch_id: Option<&str>,
) -> Result<Vec<CachedCourse>, sqlx::Error> {
    let rows = if let Some(bid) = branch_id {
        sqlx::query(
            "SELECT id, branch_id, name, duration, duration_type, updated_at FROM courses WHERE branch_id = $1 ORDER BY name",
        )
        .bind(bid)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            "SELECT id, branch_id, name, duration, duration_type, updated_at FROM courses ORDER BY name",
        )
        .fetch_all(pool)
        .await?
    };
    Ok(rows.iter().map(row_to_course).collect())
}

pub async fn get_students(
    pool: &SqlitePool,
    branch_id: Option<&str>,
) -> Result<Vec<CachedStudent>, sqlx::Error> {
    let rows = if let Some(bid) = branch_id {
        sqlx::query(
            "SELECT s.id, s.form_no, s.admission_date, s.branch_id, s.branch_name, s.course_id,
             COALESCE(c.name, s.course_name) AS course_name,
             COALESCE(c.duration, s.course_duration) AS course_duration,
             COALESCE(c.duration_type, s.course_duration_type) AS course_duration_type,
             s.student_name, s.category, s.religion, s.caste, s.gender, s.aadhar, s.address,
             s.student_phone, s.parent_phone, s.fee_year_1, s.fee_year_2, s.fee_year_3,
             s.fee_year_4, s.tuition_fee_year_1, s.tuition_fee_year_2, s.tuition_fee_year_3,
             s.tuition_fee_year_4, s.other_fee_year_1, s.other_fee_year_2, s.other_fee_year_3,
             s.other_fee_year_4, s.updated_at
             FROM students s
             LEFT JOIN courses c ON c.id = s.course_id
             WHERE s.branch_id = $1
             ORDER BY s.form_no",
        )
        .bind(bid)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            "SELECT s.id, s.form_no, s.admission_date, s.branch_id, s.branch_name, s.course_id,
             COALESCE(c.name, s.course_name) AS course_name,
             COALESCE(c.duration, s.course_duration) AS course_duration,
             COALESCE(c.duration_type, s.course_duration_type) AS course_duration_type,
             s.student_name, s.category, s.religion, s.caste, s.gender, s.aadhar, s.address,
             s.student_phone, s.parent_phone, s.fee_year_1, s.fee_year_2, s.fee_year_3,
             s.fee_year_4, s.tuition_fee_year_1, s.tuition_fee_year_2, s.tuition_fee_year_3,
             s.tuition_fee_year_4, s.other_fee_year_1, s.other_fee_year_2, s.other_fee_year_3,
             s.other_fee_year_4, s.updated_at
             FROM students s
             LEFT JOIN courses c ON c.id = s.course_id
             ORDER BY s.form_no",
        )
        .fetch_all(pool)
        .await?
    };
    Ok(rows.iter().map(row_to_student).collect())
}

pub async fn get_receipts(
    pool: &SqlitePool,
    student_id: Option<&str>,
    branch_id: Option<&str>,
) -> Result<Vec<CachedReceipt>, sqlx::Error> {
    let rows = match (student_id, branch_id) {
        (Some(sid), Some(bid)) => {
            sqlx::query(
                "SELECT id, receipt_no, receipt_date, student_id, branch_id, fee_type, amount_paid, payment_mode, reference_no, updated_at FROM receipts WHERE student_id = $1 AND branch_id = $2 ORDER BY receipt_no DESC",
            )
            .bind(sid)
            .bind(bid)
            .fetch_all(pool)
            .await?
        }
        (Some(sid), None) => {
            sqlx::query(
                "SELECT id, receipt_no, receipt_date, student_id, branch_id, fee_type, amount_paid, payment_mode, reference_no, updated_at FROM receipts WHERE student_id = $1 ORDER BY receipt_no DESC",
            )
            .bind(sid)
            .fetch_all(pool)
            .await?
        }
        (None, Some(bid)) => {
            sqlx::query(
                "SELECT id, receipt_no, receipt_date, student_id, branch_id, fee_type, amount_paid, payment_mode, reference_no, updated_at FROM receipts WHERE branch_id = $1 ORDER BY receipt_no DESC",
            )
            .bind(bid)
            .fetch_all(pool)
            .await?
        }
        (None, None) => {
            sqlx::query(
                "SELECT id, receipt_no, receipt_date, student_id, branch_id, fee_type, amount_paid, payment_mode, reference_no, updated_at FROM receipts ORDER BY receipt_no DESC",
            )
            .fetch_all(pool)
            .await?
        }
    };
    Ok(rows.iter().map(row_to_receipt).collect())
}

fn row_to_course(row: &sqlx::sqlite::SqliteRow) -> CachedCourse {
    CachedCourse {
        id: row.get("id"),
        branch_id: row.get("branch_id"),
        name: row.get("name"),
        duration: row.get("duration"),
        duration_type: row.get("duration_type"),
        updated_at: row.get("updated_at"),
    }
}

fn row_to_student(row: &sqlx::sqlite::SqliteRow) -> CachedStudent {
    CachedStudent {
        id: row.get("id"),
        form_no: row.get("form_no"),
        admission_date: row.get("admission_date"),
        branch_id: row.get("branch_id"),
        branch_name: row.get("branch_name"),
        course_id: row.get("course_id"),
        course_name: row.get("course_name"),
        course_duration: row.get("course_duration"),
        course_duration_type: row.get("course_duration_type"),
        student_name: row.get("student_name"),
        category: row.get("category"),
        religion: row.get("religion"),
        caste: row.get("caste"),
        gender: row.get("gender"),
        aadhar: row.get("aadhar"),
        address: row.get("address"),
        student_phone: row.get("student_phone"),
        parent_phone: row.get("parent_phone"),
        fee_year_1: row.get("fee_year_1"),
        fee_year_2: row.get("fee_year_2"),
        fee_year_3: row.get("fee_year_3"),
        fee_year_4: row.get("fee_year_4"),
        tuition_fee_year_1: row.get("tuition_fee_year_1"),
        tuition_fee_year_2: row.get("tuition_fee_year_2"),
        tuition_fee_year_3: row.get("tuition_fee_year_3"),
        tuition_fee_year_4: row.get("tuition_fee_year_4"),
        other_fee_year_1: row.get("other_fee_year_1"),
        other_fee_year_2: row.get("other_fee_year_2"),
        other_fee_year_3: row.get("other_fee_year_3"),
        other_fee_year_4: row.get("other_fee_year_4"),
        updated_at: row.get("updated_at"),
    }
}

fn row_to_receipt(row: &sqlx::sqlite::SqliteRow) -> CachedReceipt {
    CachedReceipt {
        id: row.get("id"),
        receipt_no: row.get("receipt_no"),
        receipt_date: row.get("receipt_date"),
        student_id: row.get("student_id"),
        branch_id: row.get("branch_id"),
        fee_type: row.get("fee_type"),
        amount_paid: row.get("amount_paid"),
        payment_mode: row.get("payment_mode"),
        reference_no: row.get("reference_no"),
        updated_at: row.get("updated_at"),
    }
}

pub async fn get_last_synced(
    pool: &SqlitePool,
    table: &str,
    scope_key: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT last_synced_at FROM sync_metadata WHERE table_name = $1 AND scope_key = $2",
    )
    .bind(table)
    .bind(scope_key)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.get("last_synced_at")))
}

pub async fn set_last_synced(
    pool: &SqlitePool,
    table: &str,
    scope_key: &str,
    server_time: &str,
    count: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT OR REPLACE INTO sync_metadata (table_name, scope_key, last_synced_at, record_count) VALUES ($1, $2, $3, $4)",
    )
    .bind(table).bind(scope_key).bind(server_time).bind(count)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_sync_status(
    pool: &SqlitePool,
    scope_key: &str,
) -> Result<serde_json::Value, sqlx::Error> {
    let courses = get_table_status(pool, "courses", scope_key).await?;
    let students = get_table_status(pool, "students", scope_key).await?;
    let receipts = get_table_status(pool, "receipts", scope_key).await?;
    Ok(serde_json::json!({
        "courses": courses,
        "students": students,
        "receipts": receipts,
    }))
}

async fn get_table_status(
    pool: &SqlitePool,
    table: &str,
    scope_key: &str,
) -> Result<serde_json::Value, sqlx::Error> {
    let row = sqlx::query("SELECT last_synced_at, record_count FROM sync_metadata WHERE table_name = $1 AND scope_key = $2")
        .bind(table)
        .bind(scope_key)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(r) => Ok(serde_json::json!({
            "last_synced": r.get::<String, _>("last_synced_at"),
            "count": r.get::<i64, _>("record_count"),
        })),
        None => Ok(serde_json::json!({ "last_synced": null, "count": 0 })),
    }
}

pub async fn reset_tables(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM courses").execute(pool).await?;
    sqlx::query("DELETE FROM students").execute(pool).await?;
    sqlx::query("DELETE FROM receipts").execute(pool).await?;
    sqlx::query("DELETE FROM sync_metadata")
        .execute(pool)
        .await?;
    Ok(())
}

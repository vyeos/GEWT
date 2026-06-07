use anyhow::Context;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, SaltString},
    Argon2, PasswordVerifier,
};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool, Postgres, Transaction};
use std::{
    collections::{HashMap, HashSet},
    env,
    net::SocketAddr,
    path::{Path as StdPath, PathBuf},
};
use thiserror::Error;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    jwt_secret: String,
}

#[derive(Debug, Error)]
enum ApiError {
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error("{0}")]
    BadRequest(String),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Jwt(#[from] jsonwebtoken::errors::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self {
            ApiError::Unauthorized => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden => StatusCode::FORBIDDEN,
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Sqlx(_) | ApiError::Jwt(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}

type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: Uuid,
    role: String,
    branch_id: Option<Uuid>,
    exp: usize,
}

#[derive(Debug, Serialize, FromRow, Clone)]
struct User {
    id: Uuid,
    user_id: String,
    name: String,
    role: String,
    branch_id: Option<Uuid>,
}

#[derive(Debug, Serialize, FromRow)]
struct Me {
    id: Uuid,
    user_id: String,
    name: String,
    role: String,
    branch_id: Option<Uuid>,
    branch_name: Option<String>,
    academic_year_start_month: i32,
}

#[derive(Debug, Serialize, FromRow)]
struct Branch {
    id: Uuid,
    code: String,
    name: String,
}

#[derive(Debug, Serialize, FromRow)]
struct Course {
    id: Uuid,
    branch_id: Uuid,
    name: String,
    duration: i32,
    duration_type: String,
}

#[derive(Debug, Serialize, FromRow)]
struct Student {
    id: Uuid,
    form_no: String,
    admission_date: NaiveDate,
    branch_id: Uuid,
    branch_name: String,
    course_id: Uuid,
    course_name: String,
    course_duration: i32,
    course_duration_type: String,
    current_course_year: i32,
    student_name: String,
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
}

#[derive(Debug, Serialize)]
struct OutstandingRow {
    #[serde(flatten)]
    student: Student,
    total_due: f64,
    total_paid: f64,
    pending: f64,
    current_period: String,
    last_receipt_no: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct Receipt {
    id: Uuid,
    receipt_no: i64,
    receipt_date: NaiveDate,
    student_id: Uuid,
    branch_id: Uuid,
    fee_type: String,
    amount_paid: f64,
    payment_mode: String,
    reference_no: Option<String>,
}

#[derive(Deserialize)]
struct LoginRequest {
    user_id: String,
    password: String,
}

#[derive(Serialize)]
struct LoginResponse {
    token: String,
}

#[derive(Serialize)]
struct NextFormNoResponse {
    form_no: String,
}

#[derive(Serialize)]
struct NextReceiptNoResponse {
    receipt_no: String,
}

#[derive(Deserialize)]
struct StudentRequest {
    form_no: Option<String>,
    admission_date: NaiveDate,
    branch_id: Uuid,
    course_id: Uuid,
    student_name: String,
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
    tuition_fee_year_1: Option<f64>,
    tuition_fee_year_2: Option<f64>,
    tuition_fee_year_3: Option<f64>,
    tuition_fee_year_4: Option<f64>,
    other_fee_year_1: Option<f64>,
    other_fee_year_2: Option<f64>,
    other_fee_year_3: Option<f64>,
    other_fee_year_4: Option<f64>,
}

struct StudentFees {
    yearly: [f64; 4],
    tuition: [f64; 4],
    other: [f64; 4],
}

#[derive(Deserialize)]
struct PromoteRequest {
    course_id: Uuid,
    admission_year: i32,
    student_ids: Vec<Uuid>,
}

#[derive(Serialize)]
struct PromoteResponse {
    promoted_count: usize,
    skipped_count: usize,
    students: Vec<Student>,
}

#[derive(Deserialize)]
struct ReceiptRequest {
    receipt_no: Option<String>,
    student_id: Uuid,
    receipt_date: NaiveDate,
    fee_type: String,
    amount_paid: f64,
    payment_mode: String,
    reference_no: Option<String>,
}

#[derive(Deserialize)]
struct CourseRequest {
    branch_id: Uuid,
    name: String,
    duration: i32,
    duration_type: String,
}

#[derive(Deserialize)]
struct UserRequest {
    user_id: String,
    name: String,
    role: String,
    branch_id: Option<Uuid>,
    password: Option<String>,
}

#[derive(Deserialize)]
struct SettingsRequest {
    academic_year_start_month: i32,
}

#[derive(Deserialize)]
struct SyncQuery {
    since: Option<String>,
    until: Option<String>,
    cursor_updated_at: Option<String>,
    cursor_id: Option<Uuid>,
    limit: Option<i64>,
}

#[derive(Debug, Serialize, FromRow)]
struct SyncCourse {
    id: Uuid,
    branch_id: Uuid,
    name: String,
    duration: i32,
    duration_type: String,
    updated_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
struct SyncStudent {
    id: Uuid,
    form_no: String,
    admission_date: NaiveDate,
    branch_id: Uuid,
    branch_name: String,
    course_id: Uuid,
    course_name: String,
    course_duration: i32,
    course_duration_type: String,
    current_course_year: i32,
    student_name: String,
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
    updated_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
struct SyncReceipt {
    id: Uuid,
    receipt_no: i64,
    receipt_date: NaiveDate,
    student_id: Uuid,
    branch_id: Uuid,
    fee_type: String,
    amount_paid: f64,
    payment_mode: String,
    reference_no: Option<String>,
    updated_at: chrono::DateTime<Utc>,
}

#[derive(Serialize)]
struct SyncPage<T: Serialize> {
    data: Vec<T>,
    has_more: bool,
    next_cursor_updated_at: Option<String>,
    next_cursor_id: Option<Uuid>,
    server_time: String,
}

pub async fn run() -> anyhow::Result<()> {
    dotenvy::from_path(format!("{}/.env", env!("CARGO_MANIFEST_DIR"))).ok();
    dotenvy::dotenv().ok();
    run_server().await
}

pub async fn run_with_env_file(env_file: Option<PathBuf>) -> anyhow::Result<()> {
    if let Some(env_file) = env_file {
        load_env_overrides(&env_file)?;
    }
    run_server().await
}

async fn run_server() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .try_init()
        .ok();
    let database_url = env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| "dev-secret-change-me".to_string());
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;

    let app = Router::new()
        .route("/health", get(|| async { Json(json!({ "ok": true })) }))
        .route("/auth/login", post(login))
        .route("/auth/me", get(me))
        .route("/branches", get(branches))
        .route("/courses", get(courses).post(create_course))
        .route("/courses/:id", patch(update_course))
        .route("/students/next-form-no", get(next_form_no))
        .route("/students", get(students).post(create_student))
        .route("/students/promote", post(promote_students))
        .route("/students/:id", get(student).patch(update_student))
        .route("/receipts/next-receipt-no", get(next_receipt_no))
        .route("/receipts", get(receipts).post(create_receipt))
        .route("/receipts/:id", get(receipt))
        .route("/receipts/:id/print", get(receipt_print))
        .route("/reports/outstanding", get(outstanding))
        .route("/sync/courses", get(sync_courses))
        .route("/sync/students", get(sync_students))
        .route("/sync/receipts", get(sync_receipts))
        .route("/users", get(users).post(create_user))
        .route("/users/:id", patch(update_user))
        .route("/academic-settings", patch(update_settings))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(AppState { pool, jwt_secret });

    let addr: SocketAddr = env::var("API_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:45123".to_string())
        .parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn load_env_overrides(path: &StdPath) -> anyhow::Result<()> {
    if !path.exists() {
        return Ok(());
    }

    for item in dotenvy::from_path_iter(path)? {
        let (key, value) = item?;
        env::set_var(key, value);
    }

    Ok(())
}

async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> ApiResult<Json<LoginResponse>> {
    let row: (Uuid, String, String, String, Option<Uuid>) = sqlx::query_as(
        "SELECT id, name, password_hash, role, branch_id FROM users WHERE user_id = $1 AND active = true",
    )
    .bind(&req.user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::Unauthorized)?;

    let parsed_hash = PasswordHash::new(&row.2).map_err(|_| ApiError::Unauthorized)?;
    Argon2::default()
        .verify_password(req.password.as_bytes(), &parsed_hash)
        .map_err(|_| ApiError::Unauthorized)?;

    let exp = (Utc::now() + Duration::hours(12)).timestamp() as usize;
    let token = encode(
        &Header::default(),
        &Claims {
            sub: row.0,
            role: row.3,
            branch_id: row.4,
            exp,
        },
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )?;
    Ok(Json(LoginResponse { token }))
}

async fn me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Me>> {
    let claims = claims(&state, &headers)?;
    let profile = sqlx::query_as::<_, Me>(
        "SELECT u.id, u.user_id, u.name, u.role, u.branch_id, b.name AS branch_name,
         s.academic_year_start_month
         FROM users u
         LEFT JOIN branches b ON b.id = u.branch_id
         CROSS JOIN academic_settings s
         WHERE u.id = $1",
    )
    .bind(claims.sub)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(profile))
}

async fn branches(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<Branch>>> {
    let auth = claims(&state, &headers)?;
    let rows = if auth.role == "admin" {
        sqlx::query_as("SELECT id, code, name FROM branches ORDER BY name")
            .fetch_all(&state.pool)
            .await?
    } else {
        sqlx::query_as("SELECT id, code, name FROM branches WHERE id = $1 ORDER BY name")
            .bind(auth.branch_id.ok_or(ApiError::Forbidden)?)
            .fetch_all(&state.pool)
            .await?
    };
    Ok(Json(rows))
}

async fn courses(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<Course>>> {
    let auth = claims(&state, &headers)?;
    let rows = if auth.role == "admin" {
        sqlx::query_as("SELECT id, branch_id, name, duration, duration_type FROM courses WHERE active = true ORDER BY name")
            .fetch_all(&state.pool)
            .await?
    } else {
        sqlx::query_as("SELECT id, branch_id, name, duration, duration_type FROM courses WHERE active = true AND branch_id = $1 ORDER BY name")
            .bind(auth.branch_id.ok_or(ApiError::Forbidden)?)
            .fetch_all(&state.pool)
            .await?
    };
    Ok(Json(rows))
}

async fn create_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CourseRequest>,
) -> ApiResult<Json<Course>> {
    require_admin(&state, &headers)?;
    let row = sqlx::query_as(
        "INSERT INTO courses (branch_id, name, duration, duration_type) VALUES ($1, $2, $3, $4)
         RETURNING id, branch_id, name, duration, duration_type",
    )
    .bind(req.branch_id)
    .bind(req.name)
    .bind(req.duration)
    .bind(req.duration_type)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

async fn update_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<CourseRequest>,
) -> ApiResult<Json<Course>> {
    require_admin(&state, &headers)?;
    let row = sqlx::query_as(
        "UPDATE courses
         SET branch_id = $1, name = $2, duration = $3, duration_type = $4, updated_at = now()
         WHERE id = $5 AND active = true
         RETURNING id, branch_id, name, duration, duration_type",
    )
    .bind(req.branch_id)
    .bind(req.name)
    .bind(req.duration)
    .bind(req.duration_type)
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

async fn students(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<Student>>> {
    let auth = claims(&state, &headers)?;
    Ok(Json(
        load_students(&state.pool, auth.branch_id.filter(|_| auth.role != "admin")).await?,
    ))
}

async fn student(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Student>> {
    let auth = claims(&state, &headers)?;
    let row = load_student(&state.pool, id).await?;
    ensure_branch(&auth, row.branch_id)?;
    Ok(Json(row))
}

async fn create_student(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<StudentRequest>,
) -> ApiResult<Json<Student>> {
    let auth = claims(&state, &headers)?;
    ensure_branch(&auth, req.branch_id)?;
    let fees = normalize_student_fees(&req)?;
    let mut tx = state.pool.begin().await?;
    let form_no = resolve_student_form_no(&mut tx, req.form_no.as_deref()).await?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO students (form_no, admission_date, branch_id, course_id, student_name, category, religion, caste, gender, aadhar, address, student_phone, parent_phone, fee_year_1, fee_year_2, fee_year_3, fee_year_4, tuition_fee_year_1, tuition_fee_year_2, tuition_fee_year_3, tuition_fee_year_4, other_fee_year_1, other_fee_year_2, other_fee_year_3, other_fee_year_4, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
         RETURNING id",
    )
    .bind(form_no)
    .bind(req.admission_date)
    .bind(req.branch_id)
    .bind(req.course_id)
    .bind(req.student_name)
    .bind(req.category)
    .bind(req.religion)
    .bind(req.caste)
    .bind(req.gender)
    .bind(req.aadhar)
    .bind(req.address)
    .bind(req.student_phone)
    .bind(req.parent_phone)
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
    .bind(auth.sub)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(load_student(&state.pool, id).await?))
}

async fn update_student(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<StudentRequest>,
) -> ApiResult<Json<Student>> {
    let auth = claims(&state, &headers)?;
    ensure_branch(&auth, req.branch_id)?;
    let existing = load_student(&state.pool, id).await?;
    ensure_branch(&auth, existing.branch_id)?;
    let fees = normalize_student_fees(&req)?;
    sqlx::query(
        "UPDATE students SET admission_date=$1, branch_id=$2, course_id=$3, student_name=$4, category=$5, religion=$6, caste=$7, gender=$8, aadhar=$9, address=$10, student_phone=$11, parent_phone=$12, fee_year_1=$13, fee_year_2=$14, fee_year_3=$15, fee_year_4=$16, tuition_fee_year_1=$17, tuition_fee_year_2=$18, tuition_fee_year_3=$19, tuition_fee_year_4=$20, other_fee_year_1=$21, other_fee_year_2=$22, other_fee_year_3=$23, other_fee_year_4=$24, updated_at=now() WHERE id=$25",
    )
    .bind(req.admission_date)
    .bind(req.branch_id)
    .bind(req.course_id)
    .bind(req.student_name)
    .bind(req.category)
    .bind(req.religion)
    .bind(req.caste)
    .bind(req.gender)
    .bind(req.aadhar)
    .bind(req.address)
    .bind(req.student_phone)
    .bind(req.parent_phone)
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
    .bind(id)
    .execute(&state.pool)
    .await?;
    Ok(Json(load_student(&state.pool, id).await?))
}

async fn promote_students(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PromoteRequest>,
) -> ApiResult<Json<PromoteResponse>> {
    let auth = claims(&state, &headers)?;
    if req.student_ids.is_empty() {
        return Err(ApiError::BadRequest(
            "Select at least one student to promote".to_string(),
        ));
    }
    if !(1900..=2200).contains(&req.admission_year) {
        return Err(ApiError::BadRequest("Invalid admission year".to_string()));
    }

    let course: Course = sqlx::query_as(
        "SELECT id, branch_id, name, duration, duration_type FROM courses WHERE id=$1 AND active = true",
    )
    .bind(req.course_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::BadRequest("Course not found".to_string()))?;
    ensure_branch(&auth, course.branch_id)?;

    let mut seen = HashSet::new();
    let student_ids: Vec<Uuid> = req
        .student_ids
        .into_iter()
        .filter(|student_id| seen.insert(*student_id))
        .collect();
    let max_year = total_course_years(course.duration, &course.duration_type);

    let mut tx = state.pool.begin().await?;
    let candidate_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT s.id
         FROM students s
         WHERE s.id = ANY($1)
           AND s.course_id = $2
           AND s.branch_id = $3
           AND EXTRACT(YEAR FROM s.admission_date)::int = $4",
    )
    .bind(&student_ids)
    .bind(course.id)
    .bind(course.branch_id)
    .bind(req.admission_year)
    .fetch_all(&mut *tx)
    .await?;

    if candidate_ids.len() != student_ids.len() {
        return Err(ApiError::BadRequest(
            "Selected students do not match the chosen course and admission year".to_string(),
        ));
    }

    let promoted_ids: Vec<Uuid> = sqlx::query_scalar(
        "UPDATE students
         SET current_course_year = current_course_year + 1,
             updated_at = now()
         WHERE id = ANY($1)
           AND current_course_year < $2
         RETURNING id",
    )
    .bind(&candidate_ids)
    .bind(max_year)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(PromoteResponse {
        promoted_count: promoted_ids.len(),
        skipped_count: candidate_ids.len().saturating_sub(promoted_ids.len()),
        students: load_students_by_ids(&state.pool, &candidate_ids).await?,
    }))
}

async fn next_form_no(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<NextFormNoResponse>> {
    claims(&state, &headers)?;
    Ok(Json(NextFormNoResponse {
        form_no: peek_form_no(&state.pool).await?,
    }))
}

async fn next_receipt_no(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<NextReceiptNoResponse>> {
    claims(&state, &headers)?;
    Ok(Json(NextReceiptNoResponse {
        receipt_no: peek_receipt_no(&state.pool).await?,
    }))
}

async fn receipts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult<Json<Vec<Receipt>>> {
    let auth = claims(&state, &headers)?;
    let student_id = params
        .get("student_id")
        .and_then(|value| value.parse::<Uuid>().ok());
    let rows = match (auth.role.as_str(), student_id) {
        ("admin", Some(student_id)) => {
            sqlx::query_as("SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no FROM receipts WHERE student_id=$1 ORDER BY receipt_no DESC")
                .bind(student_id)
                .fetch_all(&state.pool)
                .await?
        }
        ("admin", None) => {
            sqlx::query_as("SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no FROM receipts ORDER BY receipt_no DESC")
            .fetch_all(&state.pool)
            .await?
        }
        (_, Some(student_id)) => {
            sqlx::query_as("SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no FROM receipts WHERE branch_id=$1 AND student_id=$2 ORDER BY receipt_no DESC")
            .bind(auth.branch_id.ok_or(ApiError::Forbidden)?)
                .bind(student_id)
            .fetch_all(&state.pool)
            .await?
        }
        (_, None) => {
            sqlx::query_as("SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no FROM receipts WHERE branch_id=$1 ORDER BY receipt_no DESC")
                .bind(auth.branch_id.ok_or(ApiError::Forbidden)?)
                .fetch_all(&state.pool)
                .await?
        }
    };
    Ok(Json(rows))
}

async fn create_receipt(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ReceiptRequest>,
) -> ApiResult<Json<Receipt>> {
    let auth = claims(&state, &headers)?;
    if req.amount_paid <= 0.0 {
        return Err(ApiError::BadRequest("Amount paid is required".to_string()));
    }
    if !["Tuition", "Other"].contains(&req.fee_type.as_str()) {
        return Err(ApiError::BadRequest("Invalid fee type".to_string()));
    }
    if req.payment_mode != "Cash" && req.reference_no.as_deref().unwrap_or("").is_empty() {
        return Err(ApiError::BadRequest(
            "Reference number is required for this payment mode".to_string(),
        ));
    }
    let branch_id: Uuid = sqlx::query_scalar("SELECT branch_id FROM students WHERE id=$1")
        .bind(req.student_id)
        .fetch_one(&state.pool)
        .await?;
    ensure_branch(&auth, branch_id)?;
    let mut tx = state.pool.begin().await?;
    let receipt_no = resolve_receipt_no(&mut tx, req.receipt_no.as_deref()).await?;
    let row = sqlx::query_as(
        "INSERT INTO receipts (receipt_no, receipt_date, student_id, branch_id, fee_type, amount_paid, payment_mode, reference_no, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, receipt_no, receipt_date, student_id, branch_id, fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no",
    )
    .bind(receipt_no)
    .bind(req.receipt_date)
    .bind(req.student_id)
    .bind(branch_id)
    .bind(req.fee_type)
    .bind(req.amount_paid)
    .bind(req.payment_mode)
    .bind(req.reference_no)
    .bind(auth.sub)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

async fn receipt(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Receipt>> {
    let auth = claims(&state, &headers)?;
    let row: Receipt = sqlx::query_as("SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no FROM receipts WHERE id=$1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    ensure_branch(&auth, row.branch_id)?;
    Ok(Json(row))
}

async fn receipt_print(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let Json(row) = receipt(State(state), headers, Path(id)).await?;
    Ok(axum::response::Html(format!(
        "<html><body><h1>GEWT Receipt #{}</h1><p>Date: {}</p><p>Amount: {}</p><script>window.print()</script></body></html>",
        row.receipt_no, row.receipt_date, row.amount_paid
    )))
}

async fn outstanding(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<OutstandingRow>>> {
    let auth = claims(&state, &headers)?;
    let settings_month: i32 =
        sqlx::query_scalar("SELECT academic_year_start_month FROM academic_settings")
            .fetch_one(&state.pool)
            .await?;
    let all_students =
        load_students(&state.pool, auth.branch_id.filter(|_| auth.role != "admin")).await?;
    let mut rows = Vec::new();
    for student in all_students {
        let paid: f64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount_paid),0)::float8 FROM receipts WHERE student_id=$1 AND fee_type='Tuition'",
        )
        .bind(student.id)
        .fetch_one(&state.pool)
        .await?;
        let (due, label) = due_for_student(&student, settings_month);
        let pending = (due - paid).max(0.0);
        if pending > 0.0 {
            let last_receipt_no: Option<i64> = sqlx::query_scalar("SELECT receipt_no FROM receipts WHERE student_id=$1 ORDER BY receipt_no DESC LIMIT 1")
                .bind(student.id)
                .fetch_optional(&state.pool)
                .await?;
            rows.push(OutstandingRow {
                student,
                total_due: due,
                total_paid: paid,
                pending,
                current_period: label,
                last_receipt_no: last_receipt_no.map(|n| n.to_string()),
            });
        }
    }
    Ok(Json(rows))
}

async fn sync_courses(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<SyncQuery>,
) -> ApiResult<Json<SyncPage<SyncCourse>>> {
    let auth = claims(&state, &headers)?;
    let server_time = params
        .until
        .as_deref()
        .map(parse_sync_timestamp)
        .transpose()?
        .unwrap_or_else(Utc::now);
    let limit = params.limit.unwrap_or(500).clamp(1, 1000);
    let branch_filter = auth.branch_id.filter(|_| auth.role != "admin");
    let since_ts = parse_optional_sync_timestamp(params.since.as_deref(), "since")?;
    let cursor = parse_sync_cursor(&params)?;

    let rows: Vec<SyncCourse> = match (branch_filter, since_ts, cursor) {
        (Some(bid), Some(since), Some((cursor_ts, cursor_id))) => sqlx::query_as(
            "SELECT id, branch_id, name, duration, duration_type, updated_at FROM courses WHERE active = true AND branch_id = $1 AND updated_at > $2 AND updated_at <= $3 AND (updated_at, id) > ($4, $5) ORDER BY updated_at ASC, id ASC LIMIT $6"
        )
        .bind(bid).bind(since).bind(server_time).bind(cursor_ts).bind(cursor_id).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (Some(bid), Some(since), None) => sqlx::query_as(
            "SELECT id, branch_id, name, duration, duration_type, updated_at FROM courses WHERE active = true AND branch_id = $1 AND updated_at > $2 AND updated_at <= $3 ORDER BY updated_at ASC, id ASC LIMIT $4"
        )
        .bind(bid).bind(since).bind(server_time).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (Some(bid), None, Some((cursor_ts, cursor_id))) => sqlx::query_as(
            "SELECT id, branch_id, name, duration, duration_type, updated_at FROM courses WHERE active = true AND branch_id = $1 AND updated_at <= $2 AND (updated_at, id) > ($3, $4) ORDER BY updated_at ASC, id ASC LIMIT $5"
        )
        .bind(bid).bind(server_time).bind(cursor_ts).bind(cursor_id).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (Some(bid), None, None) => sqlx::query_as(
            "SELECT id, branch_id, name, duration, duration_type, updated_at FROM courses WHERE active = true AND branch_id = $1 AND updated_at <= $2 ORDER BY updated_at ASC, id ASC LIMIT $3"
        )
        .bind(bid).bind(server_time).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (None, Some(since), Some((cursor_ts, cursor_id))) => sqlx::query_as(
            "SELECT id, branch_id, name, duration, duration_type, updated_at FROM courses WHERE active = true AND updated_at > $1 AND updated_at <= $2 AND (updated_at, id) > ($3, $4) ORDER BY updated_at ASC, id ASC LIMIT $5"
        )
        .bind(since).bind(server_time).bind(cursor_ts).bind(cursor_id).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (None, Some(since), None) => sqlx::query_as(
            "SELECT id, branch_id, name, duration, duration_type, updated_at FROM courses WHERE active = true AND updated_at > $1 AND updated_at <= $2 ORDER BY updated_at ASC, id ASC LIMIT $3"
        )
        .bind(since).bind(server_time).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (None, None, Some((cursor_ts, cursor_id))) => sqlx::query_as(
            "SELECT id, branch_id, name, duration, duration_type, updated_at FROM courses WHERE active = true AND updated_at <= $1 AND (updated_at, id) > ($2, $3) ORDER BY updated_at ASC, id ASC LIMIT $4"
        )
        .bind(server_time).bind(cursor_ts).bind(cursor_id).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (None, None, None) => sqlx::query_as(
            "SELECT id, branch_id, name, duration, duration_type, updated_at FROM courses WHERE active = true AND updated_at <= $1 ORDER BY updated_at ASC, id ASC LIMIT $2"
        )
        .bind(server_time).bind(limit + 1)
        .fetch_all(&state.pool).await?,
    };

    Ok(Json(sync_page(rows, limit, server_time)))
}

async fn sync_students(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<SyncQuery>,
) -> ApiResult<Json<SyncPage<SyncStudent>>> {
    let auth = claims(&state, &headers)?;
    let server_time = params
        .until
        .as_deref()
        .map(parse_sync_timestamp)
        .transpose()?
        .unwrap_or_else(Utc::now);
    let limit = params.limit.unwrap_or(500).clamp(1, 1000);
    let branch_filter = auth.branch_id.filter(|_| auth.role != "admin");
    let since_ts = parse_optional_sync_timestamp(params.since.as_deref(), "since")?;
    let cursor = parse_sync_cursor(&params)?;

    let rows: Vec<SyncStudent> = match (branch_filter, since_ts, cursor) {
        (Some(bid), Some(since), Some((cursor_ts, cursor_id))) => sqlx::query_as(&format!(
            "{} AND s.updated_at > $2 AND s.updated_at <= $3 AND (s.updated_at, s.id) > ($4, $5) ORDER BY s.updated_at ASC, s.id ASC LIMIT $6",
            sync_student_select("WHERE s.branch_id = $1")
        ))
        .bind(bid).bind(since).bind(server_time).bind(cursor_ts).bind(cursor_id).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (Some(bid), Some(since), None) => sqlx::query_as(&format!(
            "{} AND s.updated_at > $2 AND s.updated_at <= $3 ORDER BY s.updated_at ASC, s.id ASC LIMIT $4",
            sync_student_select("WHERE s.branch_id = $1")
        ))
        .bind(bid).bind(since).bind(server_time).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (Some(bid), None, Some((cursor_ts, cursor_id))) => sqlx::query_as(&format!(
            "{} AND s.updated_at <= $2 AND (s.updated_at, s.id) > ($3, $4) ORDER BY s.updated_at ASC, s.id ASC LIMIT $5",
            sync_student_select("WHERE s.branch_id = $1")
        ))
        .bind(bid).bind(server_time).bind(cursor_ts).bind(cursor_id).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (Some(bid), None, None) => sqlx::query_as(&format!(
            "{} AND s.updated_at <= $2 ORDER BY s.updated_at ASC, s.id ASC LIMIT $3",
            sync_student_select("WHERE s.branch_id = $1")
        ))
        .bind(bid).bind(server_time).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (None, Some(since), Some((cursor_ts, cursor_id))) => sqlx::query_as(&format!(
            "{} ORDER BY s.updated_at ASC, s.id ASC LIMIT $5",
            sync_student_select("WHERE s.updated_at > $1 AND s.updated_at <= $2 AND (s.updated_at, s.id) > ($3, $4)")
        ))
        .bind(since).bind(server_time).bind(cursor_ts).bind(cursor_id).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (None, Some(since), None) => sqlx::query_as(&format!(
            "{} ORDER BY s.updated_at ASC, s.id ASC LIMIT $3",
            sync_student_select("WHERE s.updated_at > $1 AND s.updated_at <= $2")
        ))
        .bind(since).bind(server_time).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (None, None, Some((cursor_ts, cursor_id))) => sqlx::query_as(&format!(
            "{} ORDER BY s.updated_at ASC, s.id ASC LIMIT $4",
            sync_student_select("WHERE s.updated_at <= $1 AND (s.updated_at, s.id) > ($2, $3)")
        ))
        .bind(server_time).bind(cursor_ts).bind(cursor_id).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (None, None, None) => sqlx::query_as(&format!(
            "{} ORDER BY s.updated_at ASC, s.id ASC LIMIT $2",
            sync_student_select("WHERE s.updated_at <= $1")
        ))
        .bind(server_time).bind(limit + 1)
        .fetch_all(&state.pool).await?,
    };

    Ok(Json(sync_page(rows, limit, server_time)))
}

async fn sync_receipts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<SyncQuery>,
) -> ApiResult<Json<SyncPage<SyncReceipt>>> {
    let auth = claims(&state, &headers)?;
    let server_time = params
        .until
        .as_deref()
        .map(parse_sync_timestamp)
        .transpose()?
        .unwrap_or_else(Utc::now);
    let limit = params.limit.unwrap_or(500).clamp(1, 1000);
    let branch_filter = auth.branch_id.filter(|_| auth.role != "admin");
    let since_ts = parse_optional_sync_timestamp(params.since.as_deref(), "since")?;
    let cursor = parse_sync_cursor(&params)?;

    let rows: Vec<SyncReceipt> = match (branch_filter, since_ts, cursor) {
        (Some(bid), Some(since), Some((cursor_ts, cursor_id))) => sqlx::query_as(
            "SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no, updated_at FROM receipts WHERE branch_id = $1 AND updated_at > $2 AND updated_at <= $3 AND (updated_at, id) > ($4, $5) ORDER BY updated_at ASC, id ASC LIMIT $6"
        )
        .bind(bid).bind(since).bind(server_time).bind(cursor_ts).bind(cursor_id).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (Some(bid), Some(since), None) => sqlx::query_as(
            "SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no, updated_at FROM receipts WHERE branch_id = $1 AND updated_at > $2 AND updated_at <= $3 ORDER BY updated_at ASC, id ASC LIMIT $4"
        )
        .bind(bid).bind(since).bind(server_time).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (Some(bid), None, Some((cursor_ts, cursor_id))) => sqlx::query_as(
            "SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no, updated_at FROM receipts WHERE branch_id = $1 AND updated_at <= $2 AND (updated_at, id) > ($3, $4) ORDER BY updated_at ASC, id ASC LIMIT $5"
        )
        .bind(bid).bind(server_time).bind(cursor_ts).bind(cursor_id).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (Some(bid), None, None) => sqlx::query_as(
            "SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no, updated_at FROM receipts WHERE branch_id = $1 AND updated_at <= $2 ORDER BY updated_at ASC, id ASC LIMIT $3"
        )
        .bind(bid).bind(server_time).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (None, Some(since), Some((cursor_ts, cursor_id))) => sqlx::query_as(
            "SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no, updated_at FROM receipts WHERE updated_at > $1 AND updated_at <= $2 AND (updated_at, id) > ($3, $4) ORDER BY updated_at ASC, id ASC LIMIT $5"
        )
        .bind(since).bind(server_time).bind(cursor_ts).bind(cursor_id).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (None, Some(since), None) => sqlx::query_as(
            "SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no, updated_at FROM receipts WHERE updated_at > $1 AND updated_at <= $2 ORDER BY updated_at ASC, id ASC LIMIT $3"
        )
        .bind(since).bind(server_time).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (None, None, Some((cursor_ts, cursor_id))) => sqlx::query_as(
            "SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no, updated_at FROM receipts WHERE updated_at <= $1 AND (updated_at, id) > ($2, $3) ORDER BY updated_at ASC, id ASC LIMIT $4"
        )
        .bind(server_time).bind(cursor_ts).bind(cursor_id).bind(limit + 1)
        .fetch_all(&state.pool).await?,
        (None, None, None) => sqlx::query_as(
            "SELECT id, receipt_no, receipt_date, student_id, branch_id, COALESCE(fee_type, 'Tuition') AS fee_type, amount_paid::float8 AS amount_paid, payment_mode, reference_no, updated_at FROM receipts WHERE updated_at <= $1 ORDER BY updated_at ASC, id ASC LIMIT $2"
        )
        .bind(server_time).bind(limit + 1)
        .fetch_all(&state.pool).await?,
    };

    Ok(Json(sync_page(rows, limit, server_time)))
}

async fn users(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Vec<User>>> {
    require_admin(&state, &headers)?;
    Ok(Json(
        sqlx::query_as("SELECT id, user_id, name, role, branch_id FROM users ORDER BY name")
            .fetch_all(&state.pool)
            .await?,
    ))
}

trait SyncCursorRow {
    fn sync_updated_at(&self) -> DateTime<Utc>;
    fn sync_id(&self) -> Uuid;
}

impl SyncCursorRow for SyncCourse {
    fn sync_updated_at(&self) -> DateTime<Utc> {
        self.updated_at
    }

    fn sync_id(&self) -> Uuid {
        self.id
    }
}

impl SyncCursorRow for SyncStudent {
    fn sync_updated_at(&self) -> DateTime<Utc> {
        self.updated_at
    }

    fn sync_id(&self) -> Uuid {
        self.id
    }
}

impl SyncCursorRow for SyncReceipt {
    fn sync_updated_at(&self) -> DateTime<Utc> {
        self.updated_at
    }

    fn sync_id(&self) -> Uuid {
        self.id
    }
}

fn sync_page<T>(mut rows: Vec<T>, limit: i64, server_time: DateTime<Utc>) -> SyncPage<T>
where
    T: Serialize + SyncCursorRow,
{
    let has_more = rows.len() as i64 > limit;
    if has_more {
        rows.truncate(limit as usize);
    }
    let next_cursor_updated_at = rows
        .last()
        .filter(|_| has_more)
        .map(|row| row.sync_updated_at().to_rfc3339());
    let next_cursor_id = rows.last().filter(|_| has_more).map(SyncCursorRow::sync_id);

    SyncPage {
        data: rows,
        has_more,
        next_cursor_updated_at,
        next_cursor_id,
        server_time: server_time.to_rfc3339(),
    }
}

fn parse_sync_cursor(params: &SyncQuery) -> ApiResult<Option<(DateTime<Utc>, Uuid)>> {
    match (
        params
            .cursor_updated_at
            .as_deref()
            .filter(|s| !s.is_empty()),
        params.cursor_id,
    ) {
        (Some(updated_at), Some(id)) => Ok(Some((parse_sync_timestamp(updated_at)?, id))),
        (None, None) => Ok(None),
        _ => Err(ApiError::BadRequest(
            "Both cursor_updated_at and cursor_id are required".to_string(),
        )),
    }
}

fn parse_optional_sync_timestamp(
    value: Option<&str>,
    name: &str,
) -> ApiResult<Option<DateTime<Utc>>> {
    value
        .filter(|s| !s.is_empty())
        .map(|timestamp| {
            parse_sync_timestamp(timestamp)
                .map_err(|_| ApiError::BadRequest(format!("Invalid '{name}' timestamp")))
        })
        .transpose()
}

fn parse_sync_timestamp(value: &str) -> ApiResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| ApiError::BadRequest("Invalid sync timestamp".to_string()))
}

async fn create_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UserRequest>,
) -> ApiResult<Json<User>> {
    require_admin(&state, &headers)?;
    let (user_id, name, role, branch_id) = normalize_user_request(&req)?;
    let password = req
        .password
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::BadRequest("Password is required".to_string()))?;
    let password_hash = hash_password(password)?;
    let row = sqlx::query_as(
        "INSERT INTO users (user_id, name, password_hash, role, branch_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, name, role, branch_id",
    )
    .bind(user_id)
    .bind(name)
    .bind(password_hash)
    .bind(role)
    .bind(branch_id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

async fn update_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<UserRequest>,
) -> ApiResult<Json<User>> {
    require_admin(&state, &headers)?;
    let (user_id, name, role, branch_id) = normalize_user_request(&req)?;
    let row = if let Some(password) = req
        .password
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sqlx::query_as(
            "UPDATE users
             SET user_id=$1, name=$2, role=$3, branch_id=$4, password_hash=$5
             WHERE id=$6
             RETURNING id, user_id, name, role, branch_id",
        )
        .bind(user_id)
        .bind(name)
        .bind(role)
        .bind(branch_id)
        .bind(hash_password(password)?)
        .bind(id)
        .fetch_one(&state.pool)
        .await?
    } else {
        sqlx::query_as(
            "UPDATE users
             SET user_id=$1, name=$2, role=$3, branch_id=$4
             WHERE id=$5
             RETURNING id, user_id, name, role, branch_id",
        )
        .bind(user_id)
        .bind(name)
        .bind(role)
        .bind(branch_id)
        .bind(id)
        .fetch_one(&state.pool)
        .await?
    };
    Ok(Json(row))
}

async fn update_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SettingsRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    require_admin(&state, &headers)?;
    sqlx::query(
        "UPDATE academic_settings SET academic_year_start_month=$1, updated_at=now() WHERE id=true",
    )
    .bind(req.academic_year_start_month)
    .execute(&state.pool)
    .await?;
    Ok(Json(json!({ "ok": true })))
}

fn claims(state: &AppState, headers: &HeaderMap) -> ApiResult<Claims> {
    let auth = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .ok_or(ApiError::Unauthorized)?;
    let token = auth.strip_prefix("Bearer ").ok_or(ApiError::Unauthorized)?;
    Ok(decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::default(),
    )?
    .claims)
}

fn require_admin(state: &AppState, headers: &HeaderMap) -> ApiResult<Claims> {
    let auth = claims(state, headers)?;
    if auth.role != "admin" {
        return Err(ApiError::Forbidden);
    }
    Ok(auth)
}

fn ensure_branch(auth: &Claims, branch_id: Uuid) -> ApiResult<()> {
    if auth.role == "admin" || auth.branch_id == Some(branch_id) {
        Ok(())
    } else {
        Err(ApiError::Forbidden)
    }
}

fn normalize_user_request(req: &UserRequest) -> ApiResult<(String, String, String, Option<Uuid>)> {
    let user_id = req.user_id.trim().to_string();
    let name = req.name.trim().to_string();
    let role = req.role.trim().to_string();
    if user_id.is_empty() {
        return Err(ApiError::BadRequest("User ID is required".to_string()));
    }
    if name.is_empty() {
        return Err(ApiError::BadRequest("Name is required".to_string()));
    }
    if role != "admin" && role != "employee" {
        return Err(ApiError::BadRequest("Invalid role".to_string()));
    }
    if role == "employee" && req.branch_id.is_none() {
        return Err(ApiError::BadRequest(
            "Branch is required for employee users".to_string(),
        ));
    }
    Ok((
        user_id,
        name,
        role.clone(),
        if role == "admin" { None } else { req.branch_id },
    ))
}

fn normalize_student_fees(req: &StudentRequest) -> ApiResult<StudentFees> {
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

    for index in 0..yearly.len() {
        if yearly[index] < 0.0 || tuition[index] < 0.0 || other[index] < 0.0 {
            return Err(ApiError::BadRequest(
                "Fee amounts cannot be negative".to_string(),
            ));
        }
        if (tuition[index] + other[index] - yearly[index]).abs() > 0.01 {
            return Err(ApiError::BadRequest(format!(
                "Tuition fee and other fee must add up to year {} fee",
                index + 1
            )));
        }
    }

    Ok(StudentFees {
        yearly,
        tuition,
        other,
    })
}

fn hash_password(password: &str) -> ApiResult<String> {
    let salt = SaltString::generate(&mut rand_core::OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| ApiError::BadRequest("Could not hash password".to_string()))
}

async fn next_form_no_value(tx: &mut Transaction<'_, Postgres>) -> ApiResult<String> {
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(CASE WHEN form_no ~ '^\\d+$' THEN form_no::bigint END), 0) + 1 FROM students",
    )
    .fetch_one(&mut **tx)
    .await?;
    Ok(format!("{:04}", next))
}

async fn next_receipt_no_value(tx: &mut Transaction<'_, Postgres>) -> ApiResult<i64> {
    let next: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(receipt_no), 0) + 1 FROM receipts")
        .fetch_one(&mut **tx)
        .await?;
    Ok(next)
}

async fn peek_form_no(pool: &PgPool) -> ApiResult<String> {
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(CASE WHEN form_no ~ '^\\d+$' THEN form_no::bigint END), 0) + 1 FROM students",
    )
    .fetch_one(pool)
    .await?;
    Ok(format!("{:04}", next))
}

async fn peek_receipt_no(pool: &PgPool) -> ApiResult<String> {
    let next: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(receipt_no), 0) + 1 FROM receipts")
        .fetch_one(pool)
        .await?;
    Ok(next.to_string())
}

async fn resolve_student_form_no(
    tx: &mut Transaction<'_, Postgres>,
    form_no: Option<&str>,
) -> ApiResult<String> {
    let Some(form_no) = form_no.map(str::trim).filter(|value| !value.is_empty()) else {
        return next_form_no_value(tx).await;
    };
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM students WHERE form_no = $1)")
            .bind(form_no)
            .fetch_one(&mut **tx)
            .await?;
    if !exists {
        return Ok(form_no.to_string());
    }
    let parsed = form_no.parse::<i64>().unwrap_or(0);
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(CASE WHEN form_no ~ '^\\d+$' THEN form_no::bigint END), 0) + 1 FROM students WHERE CASE WHEN form_no ~ '^\\d+$' THEN form_no::bigint END >= $1",
    )
    .bind(parsed)
    .fetch_one(&mut **tx)
    .await?;
    let result = std::cmp::max(next, parsed + 1);
    Ok(format!("{:04}", result))
}

async fn resolve_receipt_no(
    tx: &mut Transaction<'_, Postgres>,
    receipt_no: Option<&str>,
) -> ApiResult<i64> {
    let Some(receipt_no) = receipt_no.map(str::trim).filter(|value| !value.is_empty()) else {
        return next_receipt_no_value(tx).await;
    };
    let parsed = receipt_no
        .parse::<i64>()
        .map_err(|_| ApiError::BadRequest("Receipt number must be numeric".to_string()))?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM receipts WHERE receipt_no = $1)")
            .bind(parsed)
            .fetch_one(&mut **tx)
            .await?;
    if !exists {
        return Ok(parsed);
    }
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(receipt_no), 0) + 1 FROM receipts WHERE receipt_no >= $1",
    )
    .bind(parsed)
    .fetch_one(&mut **tx)
    .await?;
    Ok(next)
}

async fn load_students(pool: &PgPool, branch_id: Option<Uuid>) -> ApiResult<Vec<Student>> {
    if let Some(branch_id) = branch_id {
        sqlx::query_as(student_select("WHERE s.branch_id=$1").as_str())
            .bind(branch_id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)
    } else {
        sqlx::query_as(student_select("").as_str())
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)
    }
}

async fn load_students_by_ids(pool: &PgPool, ids: &[Uuid]) -> ApiResult<Vec<Student>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    sqlx::query_as(student_select("WHERE s.id = ANY($1)").as_str())
        .bind(ids)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)
}

async fn load_student(pool: &PgPool, id: Uuid) -> ApiResult<Student> {
    sqlx::query_as(student_select("WHERE s.id=$1").as_str())
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
}

fn student_select(where_clause: &str) -> String {
    format!(
        "SELECT s.id, s.form_no, s.admission_date, s.branch_id, b.name AS branch_name, s.course_id, c.name AS course_name,
        c.duration AS course_duration, c.duration_type AS course_duration_type, s.current_course_year,
        s.student_name, s.category, s.religion, s.caste, s.gender,
        s.aadhar, s.address, s.student_phone, s.parent_phone,
        s.fee_year_1::float8 AS fee_year_1, s.fee_year_2::float8 AS fee_year_2, s.fee_year_3::float8 AS fee_year_3, s.fee_year_4::float8 AS fee_year_4,
        s.tuition_fee_year_1::float8 AS tuition_fee_year_1, s.tuition_fee_year_2::float8 AS tuition_fee_year_2, s.tuition_fee_year_3::float8 AS tuition_fee_year_3, s.tuition_fee_year_4::float8 AS tuition_fee_year_4,
        s.other_fee_year_1::float8 AS other_fee_year_1, s.other_fee_year_2::float8 AS other_fee_year_2, s.other_fee_year_3::float8 AS other_fee_year_3, s.other_fee_year_4::float8 AS other_fee_year_4
        FROM students s
        JOIN branches b ON b.id=s.branch_id
        JOIN courses c ON c.id=s.course_id
        {where_clause}
        ORDER BY s.form_no"
    )
}

fn sync_student_select(where_clause: &str) -> String {
    format!(
        "SELECT s.id, s.form_no, s.admission_date, s.branch_id, b.name AS branch_name, s.course_id, c.name AS course_name,
        c.duration AS course_duration, c.duration_type AS course_duration_type, s.current_course_year,
        s.student_name, s.category, s.religion, s.caste, s.gender,
        s.aadhar, s.address, s.student_phone, s.parent_phone,
        s.fee_year_1::float8 AS fee_year_1, s.fee_year_2::float8 AS fee_year_2, s.fee_year_3::float8 AS fee_year_3, s.fee_year_4::float8 AS fee_year_4,
        s.tuition_fee_year_1::float8 AS tuition_fee_year_1, s.tuition_fee_year_2::float8 AS tuition_fee_year_2, s.tuition_fee_year_3::float8 AS tuition_fee_year_3, s.tuition_fee_year_4::float8 AS tuition_fee_year_4,
        s.other_fee_year_1::float8 AS other_fee_year_1, s.other_fee_year_2::float8 AS other_fee_year_2, s.other_fee_year_3::float8 AS other_fee_year_3, s.other_fee_year_4::float8 AS other_fee_year_4,
        s.updated_at
        FROM students s
        JOIN branches b ON b.id=s.branch_id
        JOIN courses c ON c.id=s.course_id
        {where_clause}"
    )
}

fn total_course_years(duration: i32, duration_type: &str) -> i32 {
    let years = if duration_type == "semester" {
        (duration + 1) / 2
    } else {
        duration
    };
    years.clamp(1, 4)
}

fn due_for_student(student: &Student, _academic_start_month: i32) -> (f64, String) {
    let current_year = student
        .current_course_year
        .clamp(1, total_course_years(student.course_duration, &student.course_duration_type))
        as usize;
    let fees = [
        student.tuition_fee_year_1,
        student.tuition_fee_year_2,
        student.tuition_fee_year_3,
        student.tuition_fee_year_4,
    ];
    let total_semesters = if student.course_duration_type == "semester" {
        student.course_duration as usize
    } else {
        (student.course_duration as usize) * 2
    };
    let semester = (current_year * 2).min(total_semesters).max(1);
    let due = (0..semester).map(|i| fees[i / 2] / 2.0).sum();
    (due, format!("Semester {semester}"))
}

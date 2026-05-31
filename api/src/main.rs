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
use chrono::{Datelike, Duration, NaiveDate, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool, Postgres, Transaction};
use std::{collections::HashMap, env, net::SocketAddr};
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::from_path(format!("{}/.env", env!("CARGO_MANIFEST_DIR"))).ok();
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt().with_env_filter("info").init();
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
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
        .route("/students/:id", get(student).patch(update_student))
        .route("/receipts/next-receipt-no", get(next_receipt_no))
        .route("/receipts", get(receipts).post(create_receipt))
        .route("/receipts/:id", get(receipt))
        .route("/receipts/:id/print", get(receipt_print))
        .route("/reports/outstanding", get(outstanding))
        .route("/users", get(users).post(create_user))
        .route("/users/:id", patch(update_user))
        .route("/academic-settings", patch(update_settings))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(AppState { pool, jwt_secret });

    let addr: SocketAddr = env::var("API_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
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
         SET branch_id = $1, name = $2, duration = $3, duration_type = $4
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
    let mut tx = state.pool.begin().await?;
    let form_no = resolve_student_form_no(&mut tx, req.form_no.as_deref()).await?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO students (form_no, admission_date, branch_id, course_id, student_name, category, religion, caste, gender, aadhar, address, student_phone, parent_phone, fee_year_1, fee_year_2, fee_year_3, fee_year_4, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
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
    .bind(req.fee_year_1)
    .bind(req.fee_year_2)
    .bind(req.fee_year_3)
    .bind(req.fee_year_4)
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
    sqlx::query(
        "UPDATE students SET admission_date=$1, branch_id=$2, course_id=$3, student_name=$4, category=$5, religion=$6, caste=$7, gender=$8, aadhar=$9, address=$10, student_phone=$11, parent_phone=$12, fee_year_1=$13, fee_year_2=$14, fee_year_3=$15, fee_year_4=$16, updated_at=now() WHERE id=$17",
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
    .bind(req.fee_year_1)
    .bind(req.fee_year_2)
    .bind(req.fee_year_3)
    .bind(req.fee_year_4)
    .bind(id)
    .execute(&state.pool)
    .await?;
    Ok(Json(load_student(&state.pool, id).await?))
}

async fn next_form_no(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<NextFormNoResponse>> {
    claims(&state, &headers)?;
    Ok(Json(NextFormNoResponse {
        form_no: peek_number(&state.pool, "student_form").await?,
    }))
}

async fn next_receipt_no(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<NextReceiptNoResponse>> {
    claims(&state, &headers)?;
    Ok(Json(NextReceiptNoResponse {
        receipt_no: peek_number(&state.pool, "receipt").await?,
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

async fn users(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Vec<User>>> {
    require_admin(&state, &headers)?;
    Ok(Json(
        sqlx::query_as("SELECT id, user_id, name, role, branch_id FROM users ORDER BY name")
            .fetch_all(&state.pool)
            .await?,
    ))
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

fn hash_password(password: &str) -> ApiResult<String> {
    let salt = SaltString::generate(&mut rand_core::OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| ApiError::BadRequest("Could not hash password".to_string()))
}

async fn next_number(tx: &mut Transaction<'_, Postgres>, key: &str) -> ApiResult<String> {
    let (next_value, padding): (i64, i32) =
        sqlx::query_as("SELECT next_value, padding FROM numbering_rules WHERE key=$1 FOR UPDATE")
            .bind(key)
            .fetch_one(&mut **tx)
            .await?;
    sqlx::query("UPDATE numbering_rules SET next_value = next_value + 1 WHERE key=$1")
        .bind(key)
        .execute(&mut **tx)
        .await?;
    if padding > 0 {
        Ok(format!("{:0width$}", next_value, width = padding as usize))
    } else {
        Ok(next_value.to_string())
    }
}

async fn peek_number(pool: &PgPool, key: &str) -> ApiResult<String> {
    let (next_value, padding): (i64, i32) =
        sqlx::query_as("SELECT next_value, padding FROM numbering_rules WHERE key=$1")
            .bind(key)
            .fetch_one(pool)
            .await?;
    if padding > 0 {
        Ok(format!("{:0width$}", next_value, width = padding as usize))
    } else {
        Ok(next_value.to_string())
    }
}

async fn resolve_student_form_no(
    tx: &mut Transaction<'_, Postgres>,
    form_no: Option<&str>,
) -> ApiResult<String> {
    let Some(form_no) = form_no.map(str::trim).filter(|value| !value.is_empty()) else {
        return next_number(tx, "student_form").await;
    };
    let (next_value, _padding): (i64, i32) =
        sqlx::query_as("SELECT next_value, padding FROM numbering_rules WHERE key=$1 FOR UPDATE")
            .bind("student_form")
            .fetch_one(&mut **tx)
            .await?;
    if let Ok(value) = form_no.parse::<i64>() {
        if value >= next_value {
            sqlx::query("UPDATE numbering_rules SET next_value = $1 WHERE key=$2")
                .bind(value + 1)
                .bind("student_form")
                .execute(&mut **tx)
                .await?;
        }
    }
    Ok(form_no.to_string())
}

async fn resolve_receipt_no(
    tx: &mut Transaction<'_, Postgres>,
    receipt_no: Option<&str>,
) -> ApiResult<i64> {
    let Some(receipt_no) = receipt_no.map(str::trim).filter(|value| !value.is_empty()) else {
        return next_number(tx, "receipt")
            .await?
            .parse::<i64>()
            .map_err(|_| ApiError::BadRequest("Receipt number must be numeric".to_string()));
    };
    let value = receipt_no
        .parse::<i64>()
        .map_err(|_| ApiError::BadRequest("Receipt number must be numeric".to_string()))?;
    let (next_value, _padding): (i64, i32) =
        sqlx::query_as("SELECT next_value, padding FROM numbering_rules WHERE key=$1 FOR UPDATE")
            .bind("receipt")
            .fetch_one(&mut **tx)
            .await?;
    if value >= next_value {
        sqlx::query("UPDATE numbering_rules SET next_value = $1 WHERE key=$2")
            .bind(value + 1)
            .bind("receipt")
            .execute(&mut **tx)
            .await?;
    }
    Ok(value)
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
        c.duration AS course_duration, c.duration_type AS course_duration_type, s.student_name, s.category, s.religion, s.caste, s.gender,
        s.aadhar, s.address, s.student_phone, s.parent_phone,
        s.fee_year_1::float8 AS fee_year_1, s.fee_year_2::float8 AS fee_year_2, s.fee_year_3::float8 AS fee_year_3, s.fee_year_4::float8 AS fee_year_4
        FROM students s
        JOIN branches b ON b.id=s.branch_id
        JOIN courses c ON c.id=s.course_id
        {where_clause}
        ORDER BY s.form_no"
    )
}

fn academic_year_for(date: NaiveDate, academic_start_month: i32) -> i32 {
    if (date.month() as i32) >= academic_start_month {
        date.year()
    } else {
        date.year() - 1
    }
}

fn due_for_student(student: &Student, academic_start_month: i32) -> (f64, String) {
    let now = Utc::now().date_naive();
    let years_elapsed = academic_year_for(now, academic_start_month)
        - academic_year_for(student.admission_date, academic_start_month);
    let current_year = (years_elapsed + 1).clamp(1, 4) as usize;
    let fees = [
        student.fee_year_1,
        student.fee_year_2,
        student.fee_year_3,
        student.fee_year_4,
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

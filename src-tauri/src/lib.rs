mod backup;
mod db;

use db::{
    Branch, Course, CourseRequest, Me, OutstandingRow, PromoteRequest, PromoteResponse, Receipt,
    ReceiptRequest, SettingsRequest, Student, StudentRequest, User, UserRequest,
};
use serde::Serialize;
use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::RwLock;

/// The authenticated identity for the running app. Held in memory only; closing
/// the app clears it, so the next launch requires a fresh login.
#[derive(Clone)]
struct Session {
    user_db_id: String,
    role: String,
    branch_id: Option<String>,
}

struct AppState {
    pool: SqlitePool,
    db_path: PathBuf,
    data_dir: PathBuf,
    session: Arc<RwLock<Option<Session>>>,
}

impl AppState {
    async fn require_session(&self) -> Result<Session, String> {
        self.session
            .read()
            .await
            .clone()
            .ok_or_else(|| "Not signed in".to_string())
    }

    async fn require_admin(&self) -> Result<Session, String> {
        let session = self.require_session().await?;
        if session.role != "admin" {
            return Err("Admin access required".to_string());
        }
        Ok(session)
    }
}

fn ensure_branch(session: &Session, branch_id: &str) -> Result<(), String> {
    if session.role == "admin" || session.branch_id.as_deref() == Some(branch_id) {
        Ok(())
    } else {
        Err("You don't have access to this branch".to_string())
    }
}

/// The branch a non-admin is scoped to (None for admin = all branches).
fn branch_filter(session: &Session) -> Option<String> {
    if session.role == "admin" {
        None
    } else {
        session.branch_id.clone()
    }
}

// ---------------------------------------------------------------------------
// Auth commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn login(
    state: tauri::State<'_, AppState>,
    user_id: String,
    password: String,
) -> Result<Me, String> {
    let user = db::authenticate(&state.pool, user_id.trim(), &password).await?;
    let me = db::load_me(&state.pool, &user.id).await?;
    *state.session.write().await = Some(Session {
        user_db_id: user.id,
        role: user.role,
        branch_id: user.branch_id,
    });
    Ok(me)
}

#[tauri::command]
async fn logout(state: tauri::State<'_, AppState>) -> Result<(), String> {
    *state.session.write().await = None;
    Ok(())
}

#[tauri::command]
async fn current_user(state: tauri::State<'_, AppState>) -> Result<Option<Me>, String> {
    let Some(session) = state.session.read().await.clone() else {
        return Ok(None);
    };
    Ok(Some(db::load_me(&state.pool, &session.user_db_id).await?))
}

// ---------------------------------------------------------------------------
// Branches / courses
// ---------------------------------------------------------------------------

#[tauri::command]
async fn list_branches(state: tauri::State<'_, AppState>) -> Result<Vec<Branch>, String> {
    let session = state.require_session().await?;
    db::list_branches(&state.pool, branch_filter(&session).as_deref()).await
}

#[tauri::command]
async fn update_branch(
    state: tauri::State<'_, AppState>,
    id: String,
    code: String,
) -> Result<Branch, String> {
    state.require_admin().await?;
    db::update_branch_code(&state.pool, &id, &code).await
}

#[tauri::command]
async fn list_courses(state: tauri::State<'_, AppState>) -> Result<Vec<Course>, String> {
    let session = state.require_session().await?;
    db::list_courses(&state.pool, branch_filter(&session).as_deref()).await
}

#[tauri::command]
async fn create_course(
    state: tauri::State<'_, AppState>,
    req: CourseRequest,
) -> Result<Course, String> {
    state.require_admin().await?;
    db::create_course(&state.pool, req).await
}

#[tauri::command]
async fn update_course(
    state: tauri::State<'_, AppState>,
    id: String,
    req: CourseRequest,
) -> Result<Course, String> {
    state.require_admin().await?;
    db::update_course(&state.pool, &id, req).await
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

#[tauri::command]
async fn list_students(
    state: tauri::State<'_, AppState>,
    include_cancelled: Option<bool>,
) -> Result<Vec<Student>, String> {
    let session = state.require_session().await?;
    let include_cancelled = include_cancelled.unwrap_or(false);
    if include_cancelled && session.role != "admin" {
        return Err("Admin access required".to_string());
    }
    db::list_students(&state.pool, branch_filter(&session).as_deref(), include_cancelled).await
}

#[tauri::command]
async fn get_student(state: tauri::State<'_, AppState>, id: String) -> Result<Student, String> {
    let session = state.require_session().await?;
    let student = db::load_student(&state.pool, &id).await?;
    if student.admission_cancelled && session.role != "admin" {
        return Err("You don't have access to this student".to_string());
    }
    ensure_branch(&session, &student.branch_id)?;
    Ok(student)
}

#[tauri::command]
async fn create_student(
    state: tauri::State<'_, AppState>,
    req: StudentRequest,
) -> Result<Student, String> {
    let session = state.require_session().await?;
    ensure_branch(&session, &req.branch_id)?;
    db::create_student(&state.pool, req).await
}

#[tauri::command]
async fn update_student(
    state: tauri::State<'_, AppState>,
    id: String,
    req: StudentRequest,
) -> Result<Student, String> {
    let session = state.require_session().await?;
    ensure_branch(&session, &req.branch_id)?;
    let existing = db::load_student(&state.pool, &id).await?;
    ensure_branch(&session, &existing.branch_id)?;
    if existing.admission_cancelled && session.role != "admin" {
        return Err("You don't have access to this student".to_string());
    }
    db::update_student(&state.pool, &id, req).await
}

#[tauri::command]
async fn cancel_student(state: tauri::State<'_, AppState>, id: String) -> Result<Student, String> {
    let session = state.require_admin().await?;
    db::cancel_student(&state.pool, &id, &session.user_db_id).await
}

#[tauri::command]
async fn promote_students(
    state: tauri::State<'_, AppState>,
    req: PromoteRequest,
) -> Result<PromoteResponse, String> {
    let session = state.require_session().await?;
    // The course's branch is validated inside db::promote_students; gate access here.
    let course = db::list_courses(&state.pool, branch_filter(&session).as_deref())
        .await?
        .into_iter()
        .find(|c| c.id == req.course_id)
        .ok_or_else(|| "Course not found".to_string())?;
    ensure_branch(&session, &course.branch_id)?;
    db::promote_students(&state.pool, req).await
}

#[tauri::command]
async fn next_form_no(
    state: tauri::State<'_, AppState>,
    branch_id: String,
    date: String,
) -> Result<String, String> {
    let session = state.require_session().await?;
    ensure_branch(&session, &branch_id)?;
    db::preview_number(&state.pool, &branch_id, "form", &date).await
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

#[tauri::command]
async fn list_receipts(
    state: tauri::State<'_, AppState>,
    student_id: Option<String>,
) -> Result<Vec<Receipt>, String> {
    let session = state.require_session().await?;
    db::list_receipts(
        &state.pool,
        branch_filter(&session).as_deref(),
        student_id.as_deref(),
    )
    .await
}

#[tauri::command]
async fn create_receipt(
    state: tauri::State<'_, AppState>,
    req: ReceiptRequest,
) -> Result<Receipt, String> {
    let session = state.require_session().await?;
    let (branch_id, cancelled) = db::student_branch(&state.pool, &req.student_id).await?;
    if cancelled {
        return Err("Cannot record a receipt for a cancelled admission".to_string());
    }
    ensure_branch(&session, &branch_id)?;
    db::create_receipt(&state.pool, req, &branch_id).await
}

#[tauri::command]
async fn next_receipt_no(
    state: tauri::State<'_, AppState>,
    branch_id: String,
    date: String,
) -> Result<String, String> {
    let session = state.require_session().await?;
    ensure_branch(&session, &branch_id)?;
    db::preview_number(&state.pool, &branch_id, "receipt", &date).await
}

#[tauri::command]
async fn outstanding_report(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<OutstandingRow>, String> {
    let session = state.require_session().await?;
    db::outstanding(&state.pool, branch_filter(&session).as_deref()).await
}

// ---------------------------------------------------------------------------
// Users / settings (admin)
// ---------------------------------------------------------------------------

#[tauri::command]
async fn list_users(state: tauri::State<'_, AppState>) -> Result<Vec<User>, String> {
    state.require_admin().await?;
    db::list_users(&state.pool).await
}

#[tauri::command]
async fn create_user(state: tauri::State<'_, AppState>, req: UserRequest) -> Result<User, String> {
    state.require_admin().await?;
    db::create_user(&state.pool, req).await
}

#[tauri::command]
async fn update_user(
    state: tauri::State<'_, AppState>,
    id: String,
    req: UserRequest,
) -> Result<User, String> {
    state.require_admin().await?;
    db::update_user(&state.pool, &id, req).await
}

#[tauri::command]
async fn update_settings(
    state: tauri::State<'_, AppState>,
    req: SettingsRequest,
) -> Result<Me, String> {
    let session = state.require_admin().await?;
    db::update_settings(&state.pool, req).await?;
    db::load_me(&state.pool, &session.user_db_id).await
}

// ---------------------------------------------------------------------------
// Backup / restore / snapshots
// ---------------------------------------------------------------------------

#[tauri::command]
async fn export_backup(
    state: tauri::State<'_, AppState>,
    branch_ids: Vec<String>,
    dest_path: String,
) -> Result<(), String> {
    let session = state.require_session().await?;
    let branch_ids = if session.role == "admin" {
        branch_ids
    } else {
        // Employees may only export their own branch.
        match &session.branch_id {
            Some(b) => vec![b.clone()],
            None => return Err("No branch assigned".to_string()),
        }
    };
    backup::export_backup(
        &state.pool,
        &branch_ids,
        &session.role,
        std::path::Path::new(&dest_path),
    )
    .await
}

#[tauri::command]
async fn import_backup(
    state: tauri::State<'_, AppState>,
    src_path: String,
) -> Result<backup::ImportSummary, String> {
    let session = state.require_session().await?;
    let restrict = if session.role == "admin" {
        None
    } else {
        Some(session.branch_id.clone().ok_or_else(|| "No branch assigned".to_string())?)
    };
    let summary = backup::import_backup(
        &state.pool,
        std::path::Path::new(&src_path),
        restrict.as_deref(),
    )
    .await?;
    // The imported accounts/branch_id may differ; drop the session to be safe.
    *state.session.write().await = None;
    Ok(summary)
}

#[derive(Serialize)]
struct SnapshotInfo {
    path: String,
}

#[tauri::command]
async fn create_snapshot(state: tauri::State<'_, AppState>) -> Result<SnapshotInfo, String> {
    state.require_session().await?;
    let dir = backup::backups_dir(&state.data_dir);
    let path = backup::create_snapshot(&state.pool, &state.db_path, &dir).await?;
    Ok(SnapshotInfo {
        path: path.display().to_string(),
    })
}

// ---------------------------------------------------------------------------
// Native printing (macOS WKWebView) — unchanged from the original app
// ---------------------------------------------------------------------------

#[tauri::command]
async fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .with_webview(|_webview| {
            #[cfg(target_os = "macos")]
            macos_print(_webview.inner());
        })
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn macos_print(webview_ptr: *mut std::ffi::c_void) {
    use objc2::runtime::{AnyObject, Sel};
    use objc2::{class, msg_send, sel};

    if webview_ptr.is_null() {
        return;
    }

    unsafe {
        let webview = &*(webview_ptr as *mut AnyObject);
        let can_print: bool =
            msg_send![webview, respondsToSelector: sel!(printOperationWithPrintInfo:)];
        if !can_print {
            return;
        }
        let print_info: *mut AnyObject = msg_send![class!(NSPrintInfo), sharedPrintInfo];
        let _: () = msg_send![print_info, setTopMargin: 0.0_f64];
        let _: () = msg_send![print_info, setRightMargin: 0.0_f64];
        let _: () = msg_send![print_info, setBottomMargin: 0.0_f64];
        let _: () = msg_send![print_info, setLeftMargin: 0.0_f64];
        let operation: *mut AnyObject =
            msg_send![webview, printOperationWithPrintInfo: print_info];
        if operation.is_null() {
            return;
        }
        let _: () = msg_send![operation, setCanSpawnSeparateThread: true];
        let ns_window: *mut AnyObject = msg_send![webview, window];
        if ns_window.is_null() {
            let _: bool = msg_send![operation, runOperation];
        } else {
            let _: () = msg_send![
                operation,
                runOperationModalForWindow: ns_window,
                delegate: std::ptr::null_mut::<AnyObject>(),
                didRunSelector: None::<Sel>,
                contextInfo: std::ptr::null_mut::<std::ffi::c_void>()
            ];
        }
    }
}

// ---------------------------------------------------------------------------
// Updater (GitHub releases) — kept; downloads only app binaries, no data.
// ---------------------------------------------------------------------------

async fn install_startup_update<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    if cfg!(debug_assertions) {
        return false;
    }
    let updater = match app
        .updater_builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(updater) => updater,
        Err(error) => {
            eprintln!("GEWT update check could not be prepared: {error}");
            return false;
        }
    };
    let update = match updater.check().await {
        Ok(update) => update,
        Err(error) => {
            eprintln!("GEWT update check failed: {error}");
            return false;
        }
    };
    let Some(update) = update else {
        return false;
    };
    eprintln!("GEWT update {} is available. Installing.", update.version);
    match update.download_and_install(|_, _| {}, || {}).await {
        Ok(()) => true,
        Err(error) => {
            eprintln!("GEWT update install failed: {error}");
            false
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let update_installed = tauri::async_runtime::block_on(async {
                install_startup_update(app.handle()).await
            });
            if update_installed {
                app.handle().restart();
            }

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = db::db_file(&data_dir);

            let pool = tauri::async_runtime::block_on(async { db::init_db(&data_dir).await })
                .map_err(|e| Box::new(std::io::Error::other(e)))?;

            // Take a safety snapshot on launch if the last one is older than ~24h.
            {
                let pool = pool.clone();
                let db_path = db_path.clone();
                let dir = backup::backups_dir(&data_dir);
                if backup::needs_daily_snapshot(&dir) {
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = backup::create_snapshot(&pool, &db_path, &dir).await {
                            eprintln!("GEWT launch snapshot failed: {e}");
                        }
                    });
                }
            }

            app.manage(AppState {
                pool,
                db_path,
                data_dir,
                session: Arc::new(RwLock::new(None)),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Take a local safety snapshot when the main window closes.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    let pool = state.pool.clone();
                    let db_path = state.db_path.clone();
                    let dir = backup::backups_dir(&state.data_dir);
                    let _ = tauri::async_runtime::block_on(async {
                        backup::create_snapshot(&pool, &db_path, &dir).await
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            login,
            logout,
            current_user,
            list_branches,
            update_branch,
            list_courses,
            create_course,
            update_course,
            list_students,
            get_student,
            create_student,
            update_student,
            cancel_student,
            promote_students,
            next_form_no,
            list_receipts,
            create_receipt,
            next_receipt_no,
            outstanding_report,
            list_users,
            create_user,
            update_user,
            update_settings,
            export_backup,
            import_backup,
            create_snapshot,
            print_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod smoke_tests {
    use crate::backup;
    use crate::db::{self, CourseRequest, ReceiptRequest, StudentRequest};

    const PRT: &str = "11111111-1111-1111-1111-111111111111";
    const HMT: &str = "22222222-2222-2222-2222-222222222222";

    fn student_req(branch: &str, course: &str, date: &str, fee: f64) -> StudentRequest {
        StudentRequest {
            admission_date: date.into(),
            branch_id: branch.into(),
            course_id: course.into(),
            student_name: "Test Student".into(),
            category: "General".into(),
            religion: String::new(),
            caste: String::new(),
            gender: "Male".into(),
            aadhar: String::new(),
            address: String::new(),
            student_phone: String::new(),
            parent_phone: String::new(),
            fee_year_1: fee,
            fee_year_2: 0.0,
            fee_year_3: 0.0,
            fee_year_4: 0.0,
            tuition_fee_year_1: None,
            tuition_fee_year_2: None,
            tuition_fee_year_3: None,
            tuition_fee_year_4: None,
            other_fee_year_1: None,
            other_fee_year_2: None,
            other_fee_year_3: None,
            other_fee_year_4: None,
            current_course_period: None,
        }
    }

    fn course_req(branch: &str, name: &str) -> CourseRequest {
        CourseRequest {
            branch_id: branch.into(),
            name: name.into(),
            duration: 3,
            duration_type: "year".into(),
            letterhead: None,
        }
    }

    async fn run() -> Result<(), String> {
        let tmp = std::env::temp_dir().join(format!("gewt-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let pool = db::init_db(&tmp).await?;

        let course = db::create_course(&pool, course_req(PRT, "BCA")).await?;

        // Numbering: per-branch, per-academic-year sequence with annual reset.
        let s1 = db::create_student(&pool, student_req(PRT, &course.id, "2026-09-01", 1000.0)).await?;
        let s2 = db::create_student(&pool, student_req(PRT, &course.id, "2026-09-05", 1000.0)).await?;
        let s3 = db::create_student(&pool, student_req(PRT, &course.id, "2025-06-01", 1000.0)).await?;
        assert_eq!(s1.form_no, "PRT-11-1-2026", "first form no");
        assert_eq!(s2.form_no, "PRT-11-2-2026", "second form no increments");
        assert_eq!(s3.form_no, "PRT-11-1-2024", "resets in a different academic year");

        let receipt = db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: s1.id.clone(),
                receipt_date: "2026-09-02".into(),
                fee_type: "Tuition".into(),
                amount_paid: 500.0,
                payment_mode: "Cash".into(),
                reference_no: None,
            },
            PRT,
        )
        .await?;
        assert_eq!(receipt.receipt_no, "PRT-12-1-2026", "receipt numbering");

        // Outstanding: s3 has no receipts, so its first billed period is pending.
        let outstanding = db::outstanding(&pool, None).await?;
        assert!(
            outstanding.iter().any(|r| r.student.id == s3.id && r.pending > 0.0),
            "s3 should have a pending balance"
        );

        // Export PRT only.
        let backup_file = tmp.join("prt.gewtbak");
        backup::export_backup(&pool, &[PRT.into()], "admin", &backup_file).await?;

        // Second machine: pre-seed an HMT student, then import the PRT file.
        let tmp2 = std::env::temp_dir().join(format!("gewt-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp2).unwrap();
        let pool2 = db::init_db(&tmp2).await?;
        let hmt_course = db::create_course(&pool2, course_req(HMT, "BBA")).await?;
        let hmt_student =
            db::create_student(&pool2, student_req(HMT, &hmt_course.id, "2026-09-01", 500.0)).await?;

        let summary = backup::import_backup(&pool2, &backup_file, None).await?;
        assert_eq!(summary.students, 3, "imported 3 PRT students");

        let students2 = db::list_students(&pool2, None, false).await?;
        // Branch-partitioned: PRT students arrived, HMT student untouched.
        assert!(
            students2.iter().any(|s| s.form_no == "PRT-11-1-2026"),
            "PRT student present after import"
        );
        assert!(
            students2.iter().any(|s| s.id == hmt_student.id),
            "HMT student preserved (branch-partitioned import)"
        );

        // Re-importing must not duplicate (branch replace).
        backup::import_backup(&pool2, &backup_file, None).await?;
        let prt_count = db::list_students(&pool2, Some(PRT), true).await?.len();
        assert_eq!(prt_count, 3, "re-import replaces, does not duplicate");

        Ok(())
    }

    #[test]
    fn local_db_smoke() {
        tauri::async_runtime::block_on(run()).expect("smoke test failed");
    }
}

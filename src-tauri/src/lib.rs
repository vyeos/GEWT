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
    can_admission: bool,
    can_receipt: bool,
    can_outstanding: bool,
    can_students: bool,
    can_promote: bool,
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

fn ensure_feature(session: &Session, feature: &str) -> Result<(), String> {
    let allowed = match feature {
        "admission" => session.can_admission,
        "receipt" => session.can_receipt,
        "outstanding" => session.can_outstanding,
        "students" => session.can_students,
        "promote" => session.can_promote,
        _ => false,
    };
    if allowed {
        Ok(())
    } else {
        Err("You don't have access to this page".to_string())
    }
}

fn ensure_student_read_access(session: &Session) -> Result<(), String> {
    if session.can_receipt || session.can_students || session.can_promote {
        Ok(())
    } else {
        Err("You don't have access to this page".to_string())
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
        can_admission: user.can_admission,
        can_receipt: user.can_receipt,
        can_outstanding: user.can_outstanding,
        can_students: user.can_students,
        can_promote: user.can_promote,
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
async fn list_courses(
    state: tauri::State<'_, AppState>,
    include_archived: Option<bool>,
) -> Result<Vec<Course>, String> {
    let session = state.require_session().await?;
    let include_archived = include_archived.unwrap_or(false);
    if include_archived && session.role != "admin" {
        return Err("Admin access required".to_string());
    }
    db::list_courses(
        &state.pool,
        branch_filter(&session).as_deref(),
        include_archived,
    )
    .await
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

#[tauri::command]
async fn archive_course(state: tauri::State<'_, AppState>, id: String) -> Result<Course, String> {
    state.require_admin().await?;
    db::set_course_active(&state.pool, &id, false).await
}

#[tauri::command]
async fn unarchive_course(state: tauri::State<'_, AppState>, id: String) -> Result<Course, String> {
    state.require_admin().await?;
    db::set_course_active(&state.pool, &id, true).await
}

#[tauri::command]
async fn delete_course(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    state.require_admin().await?;
    db::delete_course(&state.pool, &id).await
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
    ensure_student_read_access(&session)?;
    if include_cancelled && session.role != "admin" {
        return Err("Admin access required".to_string());
    }
    db::list_students(
        &state.pool,
        branch_filter(&session).as_deref(),
        include_cancelled,
    )
    .await
}

#[tauri::command]
async fn create_student(
    state: tauri::State<'_, AppState>,
    req: StudentRequest,
) -> Result<Student, String> {
    let session = state.require_session().await?;
    ensure_feature(&session, "admission")?;
    ensure_branch(&session, &req.branch_id)?;
    db::create_student(&state.pool, req, &session.user_db_id).await
}

#[tauri::command]
async fn update_student(
    state: tauri::State<'_, AppState>,
    id: String,
    req: StudentRequest,
) -> Result<Student, String> {
    let session = state.require_session().await?;
    ensure_feature(&session, "students")?;
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
    ensure_feature(&session, "students")?;
    db::cancel_student(&state.pool, &id, &session.user_db_id).await
}

#[tauri::command]
async fn promote_students(
    state: tauri::State<'_, AppState>,
    req: PromoteRequest,
) -> Result<PromoteResponse, String> {
    let session = state.require_session().await?;
    ensure_feature(&session, "promote")?;
    // The course's branch is validated inside db::promote_students; gate access
    // here. Archived courses included: their students remain promotable.
    let course = db::list_courses(&state.pool, branch_filter(&session).as_deref(), true)
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
    ensure_feature(&session, "admission")?;
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
    ensure_feature(&session, "receipt")?;
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
    ensure_feature(&session, "receipt")?;
    let (branch_id, cancelled) = db::student_branch(&state.pool, &req.student_id).await?;
    if cancelled {
        return Err("Cannot record a receipt for a cancelled admission".to_string());
    }
    ensure_branch(&session, &branch_id)?;
    db::create_receipt(&state.pool, req, &branch_id, &session.user_db_id).await
}

/// Void a mistaken receipt (admin only — it reduces a student's recorded
/// payments, so it stays an administrative correction).
#[tauri::command]
async fn cancel_receipt(state: tauri::State<'_, AppState>, id: String) -> Result<Receipt, String> {
    let session = state.require_admin().await?;
    ensure_feature(&session, "receipt")?;
    db::cancel_receipt(&state.pool, &id, &session.user_db_id).await
}

#[tauri::command]
async fn next_receipt_no(
    state: tauri::State<'_, AppState>,
    branch_id: String,
    date: String,
) -> Result<String, String> {
    let session = state.require_session().await?;
    ensure_feature(&session, "receipt")?;
    ensure_branch(&session, &branch_id)?;
    db::preview_number(&state.pool, &branch_id, "receipt", &date).await
}

#[tauri::command]
async fn outstanding_report(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<OutstandingRow>, String> {
    let session = state.require_session().await?;
    ensure_feature(&session, "outstanding")?;
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
    let updated = db::update_user(&state.pool, &id, req).await?;
    // Keep the in-memory session consistent when the admin edits their own
    // account: a self-demotion or self-deactivation must take effect now, not
    // at the next login.
    let mut session = state.session.write().await;
    if session
        .as_ref()
        .map(|s| s.user_db_id == updated.id)
        .unwrap_or(false)
    {
        if updated.active {
            if let Some(s) = session.as_mut() {
                s.role = updated.role.clone();
                s.branch_id = updated.branch_id.clone();
                s.can_admission = updated.can_admission;
                s.can_receipt = updated.can_receipt;
                s.can_outstanding = updated.can_outstanding;
                s.can_students = updated.can_students;
                s.can_promote = updated.can_promote;
            }
        } else {
            *session = None;
        }
    }
    Ok(updated)
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
        Some(
            session
                .branch_id
                .clone()
                .ok_or_else(|| "No branch assigned".to_string())?,
        )
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

#[tauri::command]
async fn list_snapshots(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<backup::SnapshotEntry>, String> {
    state.require_session().await?;
    Ok(backup::list_snapshots(&backup::backups_dir(
        &state.data_dir,
    )))
}

#[tauri::command]
async fn restore_snapshot(state: tauri::State<'_, AppState>, path: String) -> Result<(), String> {
    // Restoring replaces every branch's data, so it is not branch-scoped work:
    // only an admin may roll the whole database back.
    state.require_admin().await?;
    let dir = backup::backups_dir(&state.data_dir);
    backup::restore_snapshot(&state.pool, &state.db_path, &dir, &path).await?;
    // Accounts may differ in the restored data; require a fresh login.
    *state.session.write().await = None;
    Ok(())
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
        let operation: *mut AnyObject = msg_send![webview, printOperationWithPrintInfo: print_info];
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
    // This runs before the window shows; cap the download so a flaky
    // connection can't stall app launch indefinitely. AppShell retries the
    // update in the background after startup anyway.
    let install = update.download_and_install(|_, _| {}, || {});
    match tokio::time::timeout(Duration::from_secs(180), install).await {
        Ok(Ok(())) => true,
        Ok(Err(error)) => {
            eprintln!("GEWT update install failed: {error}");
            false
        }
        Err(_) => {
            eprintln!("GEWT update download timed out; starting without it.");
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
                // A crash mid-restore can leave a *.db.restoring staging file.
                backup::cleanup_staging(&dir);
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
            archive_course,
            unarchive_course,
            delete_course,
            list_students,
            create_student,
            update_student,
            cancel_student,
            promote_students,
            next_form_no,
            list_receipts,
            create_receipt,
            cancel_receipt,
            next_receipt_no,
            outstanding_report,
            list_users,
            create_user,
            update_user,
            update_settings,
            export_backup,
            import_backup,
            create_snapshot,
            list_snapshots,
            restore_snapshot,
            print_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod smoke_tests {
    use crate::backup;
    use crate::db::{self, CourseRequest, PromoteRequest, ReceiptRequest, StudentRequest};

    const PRT: &str = "11111111-1111-1111-1111-111111111111";
    const HMT: &str = "22222222-2222-2222-2222-222222222222";
    const TLD: &str = "33333333-3333-3333-3333-333333333333";
    const ADMIN: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    fn student_req(branch: &str, course: &str, date: &str, fee: f64) -> StudentRequest {
        StudentRequest {
            admission_date: date.into(),
            branch_id: branch.into(),
            course_id: course.into(),
            student_name: "Test Student".into(),
            surname: "Test".into(),
            father_name: "Father".into(),
            category: "General".into(),
            religion: String::new(),
            caste: String::new(),
            gender: "Male".into(),
            aadhar: String::new(),
            address: String::new(),
            district: String::new(),
            taluka: String::new(),
            pincode: String::new(),
            student_phone: String::new(),
            parent_phone: String::new(),
            photo: String::new(),
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

        let prj_seed_courses = db::list_courses(&pool, Some(PRT), false).await?;
        let prj_seed_names: Vec<&str> = prj_seed_courses
            .iter()
            .map(|course| course.name.as_str())
            .collect();
        assert_eq!(
            prj_seed_names,
            vec![
                "ANM",
                "B.A.",
                "B.Ed.",
                "B.Sc.",
                "Fire & Safety",
                "GNM",
                "M.Ed",
                "M.Sc.",
                "MSW",
                "P.B.B.Sc.",
                "PTC",
                "S.I."
            ],
            "PRJ seed courses stay alphabetized"
        );
        let bsc = prj_seed_courses
            .iter()
            .find(|course| course.name == "B.Sc.")
            .unwrap();
        assert_eq!((bsc.duration, bsc.duration_type.as_str()), (8, "semester"));
        let gnm = prj_seed_courses
            .iter()
            .find(|course| course.name == "GNM")
            .unwrap();
        assert_eq!((gnm.duration, gnm.duration_type.as_str()), (3, "year"));

        for branch in [HMT, TLD] {
            let seed_names: Vec<String> = db::list_courses(&pool, Some(branch), false)
                .await?
                .into_iter()
                .map(|course| course.name)
                .collect();
            assert_eq!(seed_names, vec!["B.Sc.", "GNM", "P.B.B.Sc."]);
        }

        let course = db::create_course(&pool, course_req(PRT, "BCA")).await?;

        // Numbering: admission forms reset by academic year; receipts do not,
        // because receipt numbers no longer include the year.
        let s1 = db::create_student(
            &pool,
            student_req(PRT, &course.id, "2026-09-01", 1000.0),
            ADMIN,
        )
        .await?;
        let s2 = db::create_student(
            &pool,
            student_req(PRT, &course.id, "2026-09-05", 1000.0),
            ADMIN,
        )
        .await?;
        let s3 = db::create_student(
            &pool,
            student_req(PRT, &course.id, "2025-06-01", 1000.0),
            ADMIN,
        )
        .await?;
        assert_eq!(s1.form_no, "PRJ-1-2026", "first form no");
        assert_eq!(s2.form_no, "PRJ-2-2026", "second form no increments");
        assert_eq!(
            s3.form_no, "PRJ-1-2024",
            "resets in a different academic year"
        );

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
            ADMIN,
        )
        .await?;
        assert_eq!(receipt.receipt_no, "PRJ-1", "receipt numbering");

        // Overpayment is rejected server-side: s1's tuition due so far is 500
        // (period 1 of a 1000/year course) and it is fully paid.
        let overpay = db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: s1.id.clone(),
                receipt_date: "2026-09-03".into(),
                fee_type: "Tuition".into(),
                amount_paid: 100.0,
                payment_mode: "Cash".into(),
                reference_no: None,
            },
            PRT,
            ADMIN,
        )
        .await;
        assert!(overpay.is_err(), "overpayment must be rejected");

        // Cancelling a receipt frees the paid amount up again.
        let cancelled = db::cancel_receipt(&pool, &receipt.id, ADMIN).await?;
        assert!(cancelled.cancelled, "receipt marked cancelled");
        let repay = db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: s1.id.clone(),
                receipt_date: "2026-09-04".into(),
                fee_type: "Tuition".into(),
                amount_paid: 500.0,
                payment_mode: "Cash".into(),
                reference_no: None,
            },
            PRT,
            ADMIN,
        )
        .await?;
        assert_eq!(
            repay.receipt_no, "PRJ-2",
            "replacement receipt gets the next number"
        );

        let cross_year_receipt = db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: s2.id.clone(),
                receipt_date: "2027-09-06".into(),
                fee_type: "Tuition".into(),
                amount_paid: 500.0,
                payment_mode: "Cash".into(),
                reference_no: None,
            },
            PRT,
            ADMIN,
        )
        .await?;
        assert_eq!(
            cross_year_receipt.receipt_no, "PRJ-3",
            "yearless receipt numbers keep a branch-wide sequence"
        );

        // Decimal amounts are rejected everywhere.
        let decimal_fee = db::create_student(
            &pool,
            student_req(PRT, &course.id, "2026-09-06", 1000.5),
            ADMIN,
        )
        .await;
        assert!(decimal_fee.is_err(), "decimal fees must be rejected");
        let decimal_pay = db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: s2.id.clone(),
                receipt_date: "2026-09-06".into(),
                fee_type: "Tuition".into(),
                amount_paid: 100.5,
                payment_mode: "Cash".into(),
                reference_no: None,
            },
            PRT,
            ADMIN,
        )
        .await;
        assert!(
            decimal_pay.is_err(),
            "decimal receipt amounts must be rejected"
        );

        // Malformed dates are rejected before they reach the numbering scheme.
        let bad_date =
            db::create_student(&pool, student_req(PRT, &course.id, "", 1000.0), ADMIN).await;
        assert!(bad_date.is_err(), "empty admission date must be rejected");

        // Course archive: hidden from active lists, students still loadable,
        // delete blocked while students reference it.
        db::set_course_active(&pool, &course.id, false).await?;
        let active_courses = db::list_courses(&pool, Some(PRT), false).await?;
        assert!(
            !active_courses.iter().any(|c| c.id == course.id),
            "archived course hidden from active list"
        );
        let all_courses = db::list_courses(&pool, Some(PRT), true).await?;
        assert!(
            all_courses.iter().any(|c| c.id == course.id && !c.active),
            "archived course visible with include_archived"
        );
        assert!(
            db::load_student(&pool, &s1.id).await.is_ok(),
            "students of archived courses stay loadable"
        );
        assert!(
            db::delete_course(&pool, &course.id).await.is_err(),
            "deleting a course with students must fail"
        );
        db::set_course_active(&pool, &course.id, true).await?;
        let empty_course = db::create_course(&pool, course_req(PRT, "Empty Course")).await?;
        db::delete_course(&pool, &empty_course.id).await?;
        assert!(
            !db::list_courses(&pool, Some(PRT), true)
                .await?
                .iter()
                .any(|c| c.id == empty_course.id),
            "hard-deleted course is gone"
        );

        // Document numbers are frozen at creation: renaming the branch code
        // must not rewrite already-issued numbers.
        db::update_branch_code(&pool, PRT, "PRX").await?;
        let s1_after = db::load_student(&pool, &s1.id).await?;
        assert_eq!(
            s1_after.form_no, "PRJ-1-2026",
            "form no frozen after code rename"
        );
        let receipts_after = db::list_receipts(&pool, None, Some(&s1.id)).await?;
        assert!(
            receipts_after.iter().any(|r| r.receipt_no == "PRJ-1"),
            "receipt no frozen"
        );
        db::update_branch_code(&pool, PRT, "PRJ").await?;

        // Branch moves are blocked on edit.
        let hmt_course_p1 = db::create_course(&pool, course_req(HMT, "HMT-BBA")).await?;
        let mut move_req = student_req(HMT, &hmt_course_p1.id, "2026-09-01", 1000.0);
        move_req.student_name = "Moved".into();
        let moved = db::update_student(&pool, &s1.id, move_req).await;
        assert!(
            moved.is_err(),
            "moving a student between branches must fail"
        );

        // Semester durations must be even.
        let mut odd = course_req(PRT, "Odd Course");
        odd.duration = 3;
        odd.duration_type = "semester".into();
        assert!(
            db::create_course(&pool, odd).await.is_err(),
            "odd semester count must be rejected"
        );

        // Snapshot restore: mutate, then roll back to the snapshot.
        let backups = backup::backups_dir(&tmp);
        let db_path = db::db_file(&tmp);
        let snap = backup::create_snapshot(&pool, &db_path, &backups).await?;
        let extra = db::create_student(
            &pool,
            student_req(PRT, &course.id, "2026-09-09", 1000.0),
            ADMIN,
        )
        .await?;
        backup::restore_snapshot(&pool, &db_path, &backups, &snap.display().to_string()).await?;
        let after_restore = db::list_students(&pool, Some(PRT), true).await?;
        assert!(
            !after_restore.iter().any(|s| s.id == extra.id),
            "restore rolls back to the snapshot"
        );

        // Outstanding: s3 has no receipts, so its first billed period is pending.
        let outstanding = db::outstanding(&pool, None).await?;
        assert!(
            outstanding
                .iter()
                .any(|r| r.student.id == s3.id && r.pending > 0.0),
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
        let hmt_student = db::create_student(
            &pool2,
            student_req(HMT, &hmt_course.id, "2026-09-01", 500.0),
            ADMIN,
        )
        .await?;

        let summary = backup::import_backup(&pool2, &backup_file, None).await?;
        assert_eq!(summary.students, 3, "imported 3 PRT students");

        let students2 = db::list_students(&pool2, None, false).await?;
        // Branch-partitioned: PRT students arrived, HMT student untouched.
        assert!(
            students2.iter().any(|s| s.form_no == "PRJ-1-2026"),
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

        // Branch-restricted (employee) imports apply business data only —
        // accounts must not cross over.
        db::create_user(
            &pool,
            db::UserRequest {
                user_id: "emp1".into(),
                name: "Employee One".into(),
                role: "employee".into(),
                branch_id: Some(PRT.into()),
                password: Some("secret123".into()),
                active: true,
                can_admission: true,
                can_receipt: true,
                can_outstanding: true,
                can_students: true,
                can_promote: true,
            },
        )
        .await?;
        let backup_file2 = tmp.join("prt2.gewtbak");
        backup::export_backup(&pool, &[PRT.into()], "admin", &backup_file2).await?;
        backup::import_backup(&pool2, &backup_file2, Some(PRT)).await?;
        let users2 = db::list_users(&pool2).await?;
        assert!(
            !users2.iter().any(|u| u.user_id == "emp1"),
            "restricted import must not import accounts"
        );
        backup::import_backup(&pool2, &backup_file2, None).await?;
        let users2 = db::list_users(&pool2).await?;
        assert!(
            users2.iter().any(|u| u.user_id == "emp1"),
            "admin import applies accounts"
        );

        Ok(())
    }

    async fn completed_year_fee_lock_run() -> Result<(), String> {
        let tmp = std::env::temp_dir().join(format!("gewt-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let pool = db::init_db(&tmp).await?;
        let course = db::create_course(&pool, course_req(PRT, "Fee Lock")).await?;
        let student = db::create_student(
            &pool,
            student_req(PRT, &course.id, "2026-09-01", 1000.0),
            ADMIN,
        )
        .await?;

        for _ in 0..2 {
            db::promote_students(
                &pool,
                PromoteRequest {
                    course_id: course.id.clone(),
                    admission_year: 2026,
                    student_ids: vec![student.id.clone()],
                },
            )
            .await?;
        }

        let mut locked_fee_req = student_req(PRT, &course.id, "2026-09-01", 1200.0);
        locked_fee_req.current_course_period = Some(3);
        let locked_fee = db::update_student(&pool, &student.id, locked_fee_req).await;
        assert!(
            locked_fee.is_err(),
            "fees for a completed year must not be editable"
        );

        let mut current_year_fee_req = student_req(PRT, &course.id, "2026-09-01", 1000.0);
        current_year_fee_req.current_course_period = Some(3);
        current_year_fee_req.fee_year_2 = 1200.0;
        let current_year_fee =
            db::update_student(&pool, &student.id, current_year_fee_req).await?;
        assert_eq!(
            current_year_fee.fee_year_2, 1200.0,
            "current year fee remains editable"
        );

        Ok(())
    }

    #[test]
    fn completed_year_fee_lock() {
        tauri::async_runtime::block_on(completed_year_fee_lock_run())
            .expect("completed year fee lock test failed");
    }

    #[test]
    fn local_db_smoke() {
        tauri::async_runtime::block_on(run()).expect("smoke test failed");
    }
}

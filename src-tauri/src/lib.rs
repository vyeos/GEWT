mod backup;
mod db;
mod lan;

use db::{
    Branch, Course, CourseRequest, Me, OutstandingRow, PromoteRequest, PromoteResponse, Receipt,
    ReceiptRequest, SettingsRequest, Student, StudentRequest, User, UserRequest,
};
use serde::Serialize;
use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
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
    /// True when the open database lives in a shared LAN folder rather than this
    /// machine's app-data dir. Gates network-unsafe behaviour (auto snapshots)
    /// and enables realtime polling on the frontend.
    lan_active: bool,
    session: Arc<RwLock<Option<Session>>>,
}

/// Startup outcome the frontend reads before anything else. When `error` is set
/// the database could not be opened (e.g. a configured LAN folder is offline);
/// `AppState` is then NOT managed and the UI shows a recovery screen instead.
#[derive(Clone, Serialize)]
struct BootInfo {
    lan_active: bool,
    db_path: Option<String>,
    error: Option<String>,
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
    // Admins always have every page; the per-page flags only scope employees.
    if session.role == "admin" {
        return Ok(());
    }
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
    if session.role == "admin"
        || session.can_receipt
        || session.can_students
        || session.can_promote
    {
        Ok(())
    } else {
        Err("You don't have access to this page".to_string())
    }
}

fn ensure_receipt_read_access(session: &Session, has_student_filter: bool) -> Result<(), String> {
    if session.role == "admin"
        || session.can_receipt
        || (session.can_students && has_student_filter)
    {
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
    let session = state.require_admin().await?;
    ensure_feature(&session, "students")?;
    ensure_branch(&session, &req.branch_id)?;
    let existing = db::load_student(&state.pool, &id).await?;
    ensure_branch(&session, &existing.branch_id)?;
    db::update_student(&state.pool, &id, req).await
}

#[tauri::command]
async fn cancel_student(
    state: tauri::State<'_, AppState>,
    id: String,
    password: String,
) -> Result<Student, String> {
    let session = state.require_admin().await?;
    ensure_feature(&session, "students")?;
    if password.trim().is_empty() {
        return Err("Admin password is required".to_string());
    }
    db::verify_user_password(&state.pool, &session.user_db_id, &password).await?;
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
    ensure_receipt_read_access(&session, student_id.is_some())?;
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
// LAN mode (shared database over a network folder)
// ---------------------------------------------------------------------------

/// Read the startup outcome. The frontend calls this first: if `error` is set it
/// shows the recovery screen; otherwise it proceeds and uses `lan_active` to
/// decide whether to poll for other machines' changes.
#[tauri::command]
fn boot_status(boot: tauri::State<'_, BootInfo>) -> BootInfo {
    boot.inner().clone()
}

/// Point this machine at a shared database folder (`Some`) or back to its local
/// database (`None`). Takes effect on the next launch (the caller relaunches).
///
/// This only rewrites this machine's local pointer; it never touches data. When
/// the app booted normally we require an admin session, but when it failed to
/// boot (no pool, so no possible login) we allow it so the recovery screen can
/// switch back to local.
#[tauri::command]
async fn set_lan_db_path(app: tauri::AppHandle, dir: Option<String>) -> Result<(), String> {
    if let Some(state) = app.try_state::<AppState>() {
        state.require_admin().await?;
    }
    let dir = dir.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    if let Some(dir) = dir.as_deref() {
        let path = std::path::Path::new(dir);
        if !path.is_dir() {
            return Err("That folder does not exist or is not reachable".to_string());
        }
        // Confirm we can actually write into the shared folder before committing
        // to it, so a read-only mount is caught now rather than at next launch.
        let probe = path.join(".gewt-write-test");
        std::fs::write(&probe, b"ok")
            .map_err(|_| "That folder is not writable from this machine".to_string())?;
        let _ = std::fs::remove_file(&probe);
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    lan::write_lan_dir(&data_dir, dir.as_deref().map(std::path::Path::new))
}

/// SQLite's `data_version` — a counter that changes whenever *another* connection
/// commits a write. The frontend polls this in LAN mode to detect peers' changes
/// cheaply without re-running real queries.
#[tauri::command]
async fn db_data_version(state: tauri::State<'_, AppState>) -> Result<i64, String> {
    state.require_session().await?;
    sqlx::query_scalar("PRAGMA data_version")
        .fetch_one(&state.pool)
        .await
        .map_err(|e| e.to_string())
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

/// Read-only probe the first-run/login screen uses to decide whether to offer
/// the "Set up this device from backup" affordance. No session required — it is
/// needed before anyone can log in.
#[tauri::command]
async fn is_device_pristine(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    db::is_pristine(&state.pool).await
}

/// First-run provisioning: import a `.gewtbak` on a PRISTINE device with NO
/// login, so an employee whose account only exists in the admin's backup can set
/// their own laptop up and then sign in as themselves — no "admin logs in on the
/// employee's machine" step.
///
/// Security hinge: the ONLY reason we apply accounts here without a session is
/// the `db::is_pristine` gate. On a pristine machine the well-known seed admin
/// already grants full access, so seeding accounts without a login adds no new
/// risk; and `backup::bootstrap_import` applies accounts create-only, so this
/// path can never overwrite an existing credential (no offline password-reset
/// backdoor). If the device is already set up, we refuse and change nothing.
#[tauri::command]
async fn bootstrap_from_backup(
    state: tauri::State<'_, AppState>,
    src_path: String,
) -> Result<backup::ImportSummary, String> {
    if !db::is_pristine(&state.pool).await? {
        return Err(
            "This device is already set up. Ask an admin to import a backup after logging in."
                .to_string(),
        );
    }
    // No session ever existed on a pristine device, so there is nothing to clear.
    // The employee now signs in as themselves on the normal login screen.
    backup::bootstrap_import(&state.pool, std::path::Path::new(&src_path)).await
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
// Updater (GitHub releases) — downloads only app binaries, no data.
//
// The check/download/install flow lives entirely in the frontend (see
// `src/lib/updater.ts` + `AppShell`): on launch it checks and downloads any
// update in the background, then surfaces a "Restart to update" button so the
// user installs it on their own schedule. We deliberately do NOT block startup
// to install here — doing so delayed the window from appearing and made the
// app look frozen while a new release downloaded.
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            // Resolve where the database lives. A per-machine `lan.json` may point
            // this machine at a shared `gewt.db` in a network folder; absence of
            // it (the default) keeps the local, WAL database — unchanged.
            let lan_dir = lan::read_lan_dir(&data_dir);
            let lan_active = lan_dir.is_some();
            let db_path = match &lan_dir {
                Some(dir) => db::db_file(dir),
                None => db::db_file(&data_dir),
            };

            // In LAN mode the folder must already be reachable; we never silently
            // fall back to the local DB, as that would let a clerk enter receipts
            // into a divergent copy. A failure is surfaced via BootInfo and the
            // frontend shows a recovery screen.
            let pool = if lan_active && db_path.parent().map(|p| !p.is_dir()).unwrap_or(true) {
                Err("Shared database not reachable — reconnect the network drive and retry"
                    .to_string())
            } else {
                tauri::async_runtime::block_on(async {
                    match &lan_dir {
                        Some(dir) => db::open_pool(&db::db_file(dir), true).await,
                        None => db::init_db(&data_dir).await,
                    }
                })
            };

            let pool = match pool {
                Ok(pool) => pool,
                Err(error) => {
                    // Open the window with no AppState; the frontend reads
                    // BootInfo.error and offers Retry / Switch-to-local.
                    app.manage(BootInfo {
                        lan_active,
                        db_path: Some(db_path.display().to_string()),
                        error: Some(error),
                    });
                    return Ok(());
                }
            };

            // Automatic raw-copy snapshots are unsafe while another machine writes
            // the shared file, so they only run in local mode. (The manual
            // snapshot command and SQL-based backups remain available in LAN mode.)
            if !lan_active {
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

            app.manage(BootInfo {
                lan_active,
                db_path: Some(db_path.display().to_string()),
                error: None,
            });
            app.manage(AppState {
                pool,
                db_path,
                data_dir,
                lan_active,
                session: Arc::new(RwLock::new(None)),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Take a local safety snapshot when the main window closes.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    // Skip in LAN mode: a raw copy of a file another machine may
                    // be writing could capture an inconsistent snapshot.
                    if state.lan_active {
                        return;
                    }
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
            boot_status,
            set_lan_db_path,
            db_data_version,
            export_backup,
            import_backup,
            is_device_pristine,
            bootstrap_from_backup,
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
    use super::{
        branch_filter, ensure_branch, ensure_feature, ensure_receipt_read_access,
        ensure_student_read_access, Session,
    };
    use crate::backup;
    use crate::db::{
        self, Branch, Course, CourseRequest, OutstandingRow, PromoteRequest, Receipt,
        ReceiptRequest, Student, StudentRequest,
    };
    use serde_json::{json, Value};
    use sqlx::SqlitePool;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const PRT: &str = "11111111-1111-1111-1111-111111111111";
    const HMT: &str = "22222222-2222-2222-2222-222222222222";
    const TLD: &str = "33333333-3333-3333-3333-333333333333";
    const ADMIN: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    async fn test_pool() -> Result<(PathBuf, SqlitePool), String> {
        let tmp = std::env::temp_dir().join(format!("gewt-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let pool = db::init_db(&tmp).await?;
        Ok((tmp, pool))
    }

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

    fn employee_session(branch_id: &str) -> Session {
        Session {
            user_db_id: "employee-db-id".into(),
            role: "employee".into(),
            branch_id: Some(branch_id.into()),
            can_admission: true,
            can_receipt: false,
            can_outstanding: false,
            can_students: false,
            can_promote: false,
        }
    }

    fn write_backup_json(path: &Path, payload: &Value) -> Result<(), String> {
        let json = serde_json::to_string_pretty(payload).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| e.to_string())
    }

    fn backend_access_helpers_enforce_employee_scope() {
        let admin = Session {
            user_db_id: ADMIN.into(),
            role: "admin".into(),
            branch_id: None,
            can_admission: false,
            can_receipt: false,
            can_outstanding: false,
            can_students: false,
            can_promote: false,
        };
        assert_eq!(
            branch_filter(&admin),
            None,
            "admins are not branch-filtered"
        );
        assert!(
            ensure_branch(&admin, HMT).is_ok(),
            "admins can work across branches"
        );
        assert!(
            ensure_feature(&admin, "receipt").is_ok(),
            "admin access is not limited by employee page flags"
        );

        let employee = employee_session(PRT);
        assert_eq!(
            branch_filter(&employee).as_deref(),
            Some(PRT),
            "employees are scoped to their assigned branch"
        );
        assert!(ensure_branch(&employee, PRT).is_ok());
        assert!(
            ensure_branch(&employee, HMT).is_err(),
            "employees cannot cross into another branch"
        );
        assert!(ensure_feature(&employee, "admission").is_ok());
        assert!(
            ensure_feature(&employee, "receipt").is_err(),
            "disabled employee page flags are enforced in the backend"
        );
        assert!(
            ensure_student_read_access(&employee).is_err(),
            "admission-only employees cannot read the student register"
        );
        assert!(
            ensure_receipt_read_access(&employee, true).is_err(),
            "admission-only employees cannot read receipt history"
        );

        let mut receipt_employee = employee_session(PRT);
        receipt_employee.can_receipt = true;
        assert!(
            ensure_student_read_access(&receipt_employee).is_ok(),
            "receipt access can read students for receipt selection"
        );
        assert!(
            ensure_receipt_read_access(&receipt_employee, false).is_ok(),
            "receipt access can read receipt history"
        );

        let mut students_employee = employee_session(PRT);
        students_employee.can_students = true;
        assert!(
            ensure_receipt_read_access(&students_employee, true).is_ok(),
            "students access can read payment history in student details"
        );
        assert!(
            ensure_receipt_read_access(&students_employee, false).is_err(),
            "students access still requires a specific student receipt history"
        );
    }

    async fn receipt_validation_and_fee_breakdown_run() -> Result<(), String> {
        let (_tmp, pool) = test_pool().await?;
        let mut course_req = course_req(PRT, "Receipt Validation");
        course_req.duration = 1;
        let course = db::create_course(&pool, course_req).await?;
        let mut req = student_req(PRT, &course.id, "2026-09-01", 1200.0);
        req.tuition_fee_year_1 = Some(1000.0);
        req.other_fee_year_1 = Some(200.0);
        let student = db::create_student(&pool, req, ADMIN).await?;

        let missing_ref = db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: student.id.clone(),
                receipt_date: "2026-09-02".into(),
                fee_type: "Other".into(),
                amount_paid: 100.0,
                payment_mode: "UPI".into(),
                reference_no: Some("   ".into()),
            },
            PRT,
            ADMIN,
        )
        .await;
        assert!(
            missing_ref.is_err(),
            "non-cash receipts require a non-blank reference"
        );

        let invalid_mode = db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: student.id.clone(),
                receipt_date: "2026-09-02".into(),
                fee_type: "Other".into(),
                amount_paid: 100.0,
                payment_mode: "Card".into(),
                reference_no: Some("CARD-1".into()),
            },
            PRT,
            ADMIN,
        )
        .await;
        assert!(
            invalid_mode.is_err(),
            "unsupported payment modes are rejected"
        );

        let other = db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: student.id.clone(),
                receipt_date: "2026-09-02".into(),
                fee_type: "Other".into(),
                amount_paid: 200.0,
                payment_mode: "UPI".into(),
                reference_no: Some(" UPI-123 ".into()),
            },
            PRT,
            ADMIN,
        )
        .await?;
        assert_eq!(
            other.reference_no.as_deref(),
            Some("UPI-123"),
            "stored references are trimmed"
        );

        let overpay_other = db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: student.id.clone(),
                receipt_date: "2026-09-03".into(),
                fee_type: "Other".into(),
                amount_paid: 1.0,
                payment_mode: "Cash".into(),
                reference_no: None,
            },
            PRT,
            ADMIN,
        )
        .await;
        assert!(
            overpay_other.is_err(),
            "other-fee overpayment is rejected independently"
        );

        db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: student.id.clone(),
                receipt_date: "2026-09-04".into(),
                fee_type: "Tuition".into(),
                amount_paid: 1000.0,
                payment_mode: "Cash".into(),
                reference_no: None,
            },
            PRT,
            ADMIN,
        )
        .await?;
        assert!(
            !db::outstanding(&pool, Some(PRT))
                .await?
                .iter()
                .any(|row| row.student.id == student.id),
            "fully paid current period disappears from outstanding"
        );

        Ok(())
    }

    async fn receipt_branch_must_match_student_run() -> Result<(), String> {
        let (_tmp, pool) = test_pool().await?;
        let course = db::create_course(&pool, course_req(PRT, "Receipt Branch Guard")).await?;
        let student = db::create_student(
            &pool,
            student_req(PRT, &course.id, "2026-09-01", 1000.0),
            ADMIN,
        )
        .await?;

        let wrong_branch = db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: student.id.clone(),
                receipt_date: "2026-09-02".into(),
                fee_type: "Tuition".into(),
                amount_paid: 500.0,
                payment_mode: "Cash".into(),
                reference_no: None,
            },
            HMT,
            ADMIN,
        )
        .await;
        assert!(
            wrong_branch.is_err(),
            "receipts cannot be recorded under a branch other than the student's branch"
        );
        assert!(
            db::list_receipts(&pool, None, Some(&student.id))
                .await?
                .is_empty(),
            "the rejected cross-branch receipt leaves no stored receipt behind"
        );

        Ok(())
    }

    async fn student_fee_split_validation_run() -> Result<(), String> {
        let (_tmp, pool) = test_pool().await?;
        let course = db::create_course(&pool, course_req(PRT, "Fee Split")).await?;

        let mut mismatch = student_req(PRT, &course.id, "2026-09-01", 1000.0);
        mismatch.tuition_fee_year_1 = Some(700.0);
        mismatch.other_fee_year_1 = Some(200.0);
        assert!(
            db::create_student(&pool, mismatch, ADMIN).await.is_err(),
            "tuition and other fees must add up to the yearly fee"
        );

        let negative = student_req(PRT, &course.id, "2026-09-01", -1.0);
        assert!(
            db::create_student(&pool, negative, ADMIN).await.is_err(),
            "negative fees are rejected"
        );

        let mut valid = student_req(PRT, &course.id, "2026-09-01", 1000.0);
        valid.tuition_fee_year_1 = Some(750.0);
        valid.other_fee_year_1 = Some(250.0);
        let student = db::create_student(&pool, valid, ADMIN).await?;
        assert_eq!(student.tuition_fee_year_1, 750.0);
        assert_eq!(student.other_fee_year_1, 250.0);

        Ok(())
    }

    async fn fee_edit_cannot_drop_below_paid_run() -> Result<(), String> {
        let (_tmp, pool) = test_pool().await?;
        // Two-year course so a 2nd-year student has live (editable) year-2 fees.
        let mut course_req = course_req(PRT, "Fee Lowering Guard");
        course_req.duration = 2;
        let course = db::create_course(&pool, course_req).await?;

        let mut req = student_req(PRT, &course.id, "2026-09-01", 60000.0);
        // Year 1: 60000 tuition + 0 other. Year 2: 70000 tuition + 60000 other.
        req.tuition_fee_year_1 = Some(60000.0);
        req.other_fee_year_1 = Some(0.0);
        req.fee_year_2 = 130000.0;
        req.tuition_fee_year_2 = Some(70000.0);
        req.other_fee_year_2 = Some(60000.0);
        // Years 3 and 4 are unused on a two-year course.
        req.fee_year_3 = 0.0;
        req.tuition_fee_year_3 = Some(0.0);
        req.other_fee_year_3 = Some(0.0);
        req.fee_year_4 = 0.0;
        req.tuition_fee_year_4 = Some(0.0);
        req.other_fee_year_4 = Some(0.0);
        let student = db::create_student(&pool, req, ADMIN).await?;

        // Advance the student into year 2 (period 3) so the year-2 tuition is billable.
        let promoted = db::promote_students(
            &pool,
            PromoteRequest {
                course_id: course.id.clone(),
                admission_year: 2026,
                student_ids: vec![student.id.clone()],
            },
        )
        .await?;
        let student = promoted.students.into_iter().next().unwrap();

        // Collect the full tuition: 60000 (year 1) + 70000 (year 2) = 130000.
        db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: student.id.clone(),
                receipt_date: "2027-09-02".into(),
                fee_type: "Tuition".into(),
                amount_paid: 130000.0,
                payment_mode: "Cash".into(),
                reference_no: None,
            },
            PRT,
            ADMIN,
        )
        .await?;

        // Admin mistakenly drops year-2 tuition from 70000 to 60000, which would
        // strand 10000 of the collected tuition. This must be rejected.
        let mut shrink = student_to_request(&student);
        shrink.fee_year_2 = 120000.0;
        shrink.tuition_fee_year_2 = Some(60000.0);
        shrink.other_fee_year_2 = Some(60000.0);
        assert!(
            db::update_student(&pool, &student.id, shrink).await.is_err(),
            "tuition total cannot be lowered below the tuition already paid"
        );

        // The stored fee is untouched after the rejected edit.
        let reloaded = db::list_students(&pool, Some(PRT), false)
            .await?
            .into_iter()
            .find(|s| s.id == student.id)
            .expect("student still present");
        assert_eq!(reloaded.tuition_fee_year_2, 70000.0);

        // A correction that keeps the tuition total at or above the paid amount
        // is still allowed: raising year-2 tuition to 80000 is fine.
        let mut raise = student_to_request(&reloaded);
        raise.fee_year_2 = 140000.0;
        raise.tuition_fee_year_2 = Some(80000.0);
        raise.other_fee_year_2 = Some(60000.0);
        db::update_student(&pool, &reloaded.id, raise).await?;

        Ok(())
    }

    async fn backup_import_rejects_cross_branch_payloads_run() -> Result<(), String> {
        let (tmp, source) = test_pool().await?;
        let course = db::create_course(&source, course_req(PRT, "Backup Export Course")).await?;
        db::create_student(
            &source,
            student_req(PRT, &course.id, "2026-09-01", 1000.0),
            ADMIN,
        )
        .await?;
        let backup_file = tmp.join("prj.gewtbak");
        backup::export_backup(&source, &[PRT.into()], "admin", &backup_file).await?;
        let base_payload: Value =
            serde_json::from_slice(&std::fs::read(&backup_file).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;

        let (_dest_tmp, dest) = test_pool().await?;
        let sentinel_course = db::create_course(&dest, course_req(PRT, "Sentinel Course")).await?;
        let sentinel_student = db::create_student(
            &dest,
            student_req(PRT, &sentinel_course.id, "2026-09-03", 1000.0),
            ADMIN,
        )
        .await?;

        let mut out_of_branch_payload = base_payload.clone();
        let injected_course_id = uuid::Uuid::new_v4().to_string();
        out_of_branch_payload["data"]["courses"]
            .as_array_mut()
            .ok_or("courses missing from backup payload")?
            .push(json!({
                "id": injected_course_id,
                "branch_id": HMT,
                "name": "Injected HMT Course",
                "duration": 1,
                "duration_type": "year",
                "letterhead": null,
                "active": 1,
                "updated_at": "2099-01-01T00:00:00Z"
            }));
        let bad_course_file = tmp.join("bad-course.gewtbak");
        write_backup_json(&bad_course_file, &out_of_branch_payload)?;
        let bad_course_import = backup::import_backup(&dest, &bad_course_file, Some(PRT)).await;
        assert!(
            bad_course_import.is_err(),
            "restricted imports reject data rows outside the declared branch"
        );
        assert!(
            !db::list_courses(&dest, Some(HMT), true)
                .await?
                .iter()
                .any(|course| course.id == injected_course_id),
            "the rejected import does not add the out-of-branch course"
        );
        assert!(
            db::load_student(&dest, &sentinel_student.id).await.is_ok(),
            "the rejected import leaves existing branch data untouched"
        );

        let mut cross_link_payload = base_payload.clone();
        cross_link_payload["data"]["students"]
            .as_array_mut()
            .and_then(|students| students.first_mut())
            .and_then(|student| student.as_object_mut())
            .ok_or("students missing from backup payload")?
            .insert(
                "course_id".into(),
                Value::String("22222222-2222-2222-2222-000000000001".into()),
            );
        let bad_student_file = tmp.join("bad-student-course.gewtbak");
        write_backup_json(&bad_student_file, &cross_link_payload)?;
        let bad_student_import = backup::import_backup(&dest, &bad_student_file, None).await;
        assert!(
            bad_student_import.is_err(),
            "imports reject students linked to a course from another branch"
        );
        assert!(
            db::load_student(&dest, &sentinel_student.id).await.is_ok(),
            "failed cross-link imports also leave existing data untouched"
        );

        Ok(())
    }

    async fn promotion_advances_one_year_and_stops_at_course_end_run() -> Result<(), String> {
        let (_tmp, pool) = test_pool().await?;
        let mut one_year_req = course_req(PRT, "One Year");
        one_year_req.duration = 1;
        let course = db::create_course(&pool, one_year_req).await?;
        let student = db::create_student(
            &pool,
            student_req(PRT, &course.id, "2026-09-01", 1000.0),
            ADMIN,
        )
        .await?;

        let first = db::promote_students(
            &pool,
            PromoteRequest {
                course_id: course.id.clone(),
                admission_year: 2026,
                student_ids: vec![student.id.clone(), student.id.clone()],
            },
        )
        .await?;
        assert_eq!(first.promoted_count, 1, "duplicate ids are promoted once");
        assert_eq!(
            first.skipped_count, 0,
            "duplicates are not counted as skips"
        );
        assert_eq!(
            first.students[0].current_course_period, 2,
            "one-year courses cap at their final second period"
        );

        let second = db::promote_students(
            &pool,
            PromoteRequest {
                course_id: course.id.clone(),
                admission_year: 2026,
                student_ids: vec![student.id.clone()],
            },
        )
        .await?;
        assert_eq!(second.promoted_count, 0);
        assert_eq!(
            second.skipped_count, 1,
            "students at final period are skipped"
        );
        assert_eq!(second.students[0].current_course_period, 2);

        let mut two_year_req = course_req(PRT, "Two Year");
        two_year_req.duration = 2;
        let two_year_course = db::create_course(&pool, two_year_req).await?;
        let two_year_student = db::create_student(
            &pool,
            student_req(PRT, &two_year_course.id, "2026-09-01", 1000.0),
            ADMIN,
        )
        .await?;
        let promoted_one_year = db::promote_students(
            &pool,
            PromoteRequest {
                course_id: two_year_course.id.clone(),
                admission_year: 2026,
                student_ids: vec![two_year_student.id.clone()],
            },
        )
        .await?;
        assert_eq!(
            promoted_one_year.students[0].current_course_period, 3,
            "promotion advances by one full year, or two fee periods"
        );

        Ok(())
    }

    async fn academic_year_settings_affect_numbering_run() -> Result<(), String> {
        let (_tmp, pool) = test_pool().await?;
        let before = db::preview_number(&pool, PRT, "form", "2026-06-01").await?;
        assert_eq!(before, "PRJ-1-2025");

        db::update_settings(
            &pool,
            db::SettingsRequest {
                academic_year_start_month: 6,
            },
        )
        .await?;
        let after = db::preview_number(&pool, PRT, "form", "2026-06-01").await?;
        assert_eq!(after, "PRJ-1-2026");

        let invalid = db::update_settings(
            &pool,
            db::SettingsRequest {
                academic_year_start_month: 13,
            },
        )
        .await;
        assert!(invalid.is_err(), "invalid start months are rejected");

        Ok(())
    }

    async fn cancelled_admission_is_hidden_and_zeroed_run() -> Result<(), String> {
        let (_tmp, pool) = test_pool().await?;
        let course = db::create_course(&pool, course_req(PRT, "Cancel Me")).await?;
        let student = db::create_student(
            &pool,
            student_req(PRT, &course.id, "2026-09-01", 1000.0),
            ADMIN,
        )
        .await?;

        let cancelled = db::cancel_student(&pool, &student.id, ADMIN).await?;
        assert!(cancelled.admission_cancelled);
        assert_eq!(cancelled.fee_year_1, 0.0);
        assert_eq!(cancelled.tuition_fee_year_1, 0.0);

        let active = db::list_students(&pool, Some(PRT), false).await?;
        assert!(
            !active.iter().any(|s| s.id == student.id),
            "cancelled students are hidden from active student lists"
        );
        let with_cancelled = db::list_students(&pool, Some(PRT), true).await?;
        assert!(
            with_cancelled.iter().any(|s| s.id == student.id),
            "cancelled students remain available for admin review"
        );
        assert!(
            !db::outstanding(&pool, Some(PRT))
                .await?
                .iter()
                .any(|row| row.student.id == student.id),
            "cancelled admissions do not appear as outstanding"
        );

        Ok(())
    }

    async fn course_branch_moves_respect_enrollment_run() -> Result<(), String> {
        let (_tmp, pool) = test_pool().await?;
        let empty = db::create_course(&pool, course_req(PRT, "Movable")).await?;
        let moved = db::update_course(&pool, &empty.id, course_req(HMT, "Movable")).await?;
        assert_eq!(moved.branch_id, HMT, "empty courses can move branches");

        let enrolled = db::create_course(&pool, course_req(PRT, "Anchored")).await?;
        db::create_student(
            &pool,
            student_req(PRT, &enrolled.id, "2026-09-01", 1000.0),
            ADMIN,
        )
        .await?;
        let moved_enrolled =
            db::update_course(&pool, &enrolled.id, course_req(HMT, "Anchored")).await;
        assert!(
            moved_enrolled.is_err(),
            "courses with admitted students cannot move branches"
        );

        Ok(())
    }

    fn year_row(row: &OutstandingRow, year: i32) -> &db::OutstandingYearBreakdown {
        row.year_breakdown
            .iter()
            .find(|y| y.year == year)
            .unwrap_or_else(|| panic!("year {year} breakdown missing"))
    }

    async fn promote_to_period(
        pool: &SqlitePool,
        course: &Course,
        student_id: &str,
        target_period: i64,
    ) -> Result<(), String> {
        let mut current = db::load_student(pool, student_id)
            .await?
            .current_course_period;
        while current < target_period {
            db::promote_students(
                pool,
                PromoteRequest {
                    course_id: course.id.clone(),
                    admission_year: 2026,
                    student_ids: vec![student_id.to_string()],
                },
            )
            .await?;
            let next = db::load_student(pool, student_id)
                .await?
                .current_course_period;
            if next == current {
                break;
            }
            current = next;
        }
        Ok(())
    }

    // Exercises allocate_fee_by_year / outstanding_year_breakdown: a partial
    // payment must fill the earliest billed periods first, split tuition and
    // other fees independently, and roll up into the right per-year totals.
    async fn outstanding_partial_payment_allocation_run() -> Result<(), String> {
        let (_tmp, pool) = test_pool().await?;
        let mut req = course_req(PRT, "Partial Pay");
        req.duration = 2;
        req.duration_type = "year".into();
        let course = db::create_course(&pool, req).await?;

        // Year 1: 1000 (tuition 800 / other 200). Year 2: 2000 (tuition 1500 /
        // other 500). A 2-year course bills four periods, two per year.
        let make = |date: &str| {
            let mut req = student_req(PRT, &course.id, date, 1000.0);
            req.tuition_fee_year_1 = Some(800.0);
            req.other_fee_year_1 = Some(200.0);
            req.fee_year_2 = 2000.0;
            req.tuition_fee_year_2 = Some(1500.0);
            req.other_fee_year_2 = Some(500.0);
            req
        };
        let cross = db::create_student(&pool, make("2026-09-01"), ADMIN).await?;
        let intra = db::create_student(&pool, make("2026-09-02"), ADMIN).await?;

        // Both reach period 3 (year 2): periods 1-4 are now due because
        // billing is collected for the full current year.
        promote_to_period(&pool, &course, &cross.id, 3).await?;
        promote_to_period(&pool, &course, &intra.id, 3).await?;

        // Tuition due so far: 800 (year 1) + 1500 (year 2) = 2300.
        // Pay 1000 -> fills year 1 (800), spills 200 into year 2.
        db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: cross.id.clone(),
                receipt_date: "2027-02-05".into(),
                fee_type: "Tuition".into(),
                amount_paid: 1000.0,
                payment_mode: "Cash".into(),
                reference_no: None,
            },
            PRT,
            ADMIN,
        )
        .await?;
        // Pay 300 -> stays entirely in year 1 before year 2 sees anything.
        db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: intra.id.clone(),
                receipt_date: "2027-02-05".into(),
                fee_type: "Tuition".into(),
                amount_paid: 300.0,
                payment_mode: "Cash".into(),
                reference_no: None,
            },
            PRT,
            ADMIN,
        )
        .await?;

        let rows = db::outstanding(&pool, Some(PRT)).await?;
        let cross_row = rows
            .iter()
            .find(|r| r.student.id == cross.id)
            .ok_or("cross-year row missing")?;
        let intra_row = rows
            .iter()
            .find(|r| r.student.id == intra.id)
            .ok_or("intra-year row missing")?;

        // Cross-year payment: year 1 tuition fully covered before year 2 sees a
        // rupee, proving earliest-period-first allocation.
        let cy1 = year_row(cross_row, 1);
        assert_eq!(
            (cy1.tuition.due, cy1.tuition.paid, cy1.tuition.pending),
            (800.0, 800.0, 0.0)
        );
        assert_eq!(
            (cy1.other.due, cy1.other.paid, cy1.other.pending),
            (200.0, 0.0, 200.0)
        );
        assert_eq!(
            (cy1.total_due, cy1.total_paid, cy1.pending),
            (1000.0, 800.0, 200.0)
        );
        let cy2 = year_row(cross_row, 2);
        assert_eq!(
            (cy2.tuition.due, cy2.tuition.paid, cy2.tuition.pending),
            (1500.0, 200.0, 1300.0)
        );
        assert_eq!(
            (cy2.other.due, cy2.other.paid, cy2.other.pending),
            (500.0, 0.0, 500.0)
        );
        assert_eq!(
            (cy2.total_due, cy2.total_paid, cy2.pending),
            (2000.0, 200.0, 1800.0)
        );
        assert_eq!(
            (cross_row.total_due, cross_row.total_paid, cross_row.pending),
            (3000.0, 1000.0, 2000.0)
        );

        // Intra-year partial: 300 lands in year 1, leaving year 2 untouched.
        let iy1 = year_row(intra_row, 1);
        assert_eq!(
            (iy1.tuition.due, iy1.tuition.paid, iy1.tuition.pending),
            (800.0, 300.0, 500.0)
        );
        let iy2 = year_row(intra_row, 2);
        assert_eq!(
            (iy2.tuition.due, iy2.tuition.paid, iy2.tuition.pending),
            (1500.0, 0.0, 1500.0)
        );

        Ok(())
    }

    // Courses longer than the 4-year / 8-semester fee model must be rejected at
    // creation, with the boundary values still accepted.
    async fn course_duration_is_capped_run() -> Result<(), String> {
        let (_tmp, pool) = test_pool().await?;

        let mut five_years = course_req(PRT, "Too Long Years");
        five_years.duration = 5;
        five_years.duration_type = "year".into();
        assert!(
            db::create_course(&pool, five_years).await.is_err(),
            "courses longer than 4 years must be rejected"
        );

        let mut ten_sems = course_req(PRT, "Too Long Sems");
        ten_sems.duration = 10;
        ten_sems.duration_type = "semester".into();
        assert!(
            db::create_course(&pool, ten_sems).await.is_err(),
            "courses longer than 8 semesters must be rejected"
        );

        let mut four_years = course_req(PRT, "Four Years");
        four_years.duration = 4;
        four_years.duration_type = "year".into();
        assert!(
            db::create_course(&pool, four_years).await.is_ok(),
            "the 4-year boundary stays valid"
        );

        let mut eight_sems = course_req(PRT, "Eight Sems");
        eight_sems.duration = 8;
        eight_sems.duration_type = "semester".into();
        assert!(
            db::create_course(&pool, eight_sems).await.is_ok(),
            "the 8-semester boundary stays valid"
        );

        Ok(())
    }

    // A database created by an older version still carries the unused
    // current_course_year column; the schema migration must drop it on the next
    // launch without losing student data.
    async fn legacy_current_course_year_column_is_dropped_run() -> Result<(), String> {
        let tmp = std::env::temp_dir().join(format!("gewt-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let db_path = db::db_file(&tmp);

        // Simulate a pre-existing database that still carries the legacy column.
        {
            let pool = db::init_db(&tmp).await?;
            sqlx::query(
                "ALTER TABLE students ADD COLUMN current_course_year INTEGER NOT NULL DEFAULT 1 CHECK (current_course_year BETWEEN 1 AND 4)",
            )
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
            let course = db::create_course(&pool, course_req(PRT, "Legacy")).await?;
            db::create_student(
                &pool,
                student_req(PRT, &course.id, "2026-09-01", 1000.0),
                ADMIN,
            )
            .await?;
            pool.close().await;
        }

        // Re-open: migrate_schema should drop the legacy column without data loss.
        let pool = db::open_pool(&db_path, false).await?;
        let has_col: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('students') WHERE name = 'current_course_year'",
        )
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
        assert_eq!(
            has_col, 0,
            "legacy current_course_year column should be dropped"
        );
        let students = db::list_students(&pool, Some(PRT), true).await?;
        assert_eq!(students.len(), 1, "student survives the column drop");

        Ok(())
    }

    #[derive(Clone)]
    struct FlowStudent {
        id: String,
        course_id: String,
        slot: usize,
    }

    #[derive(serde::Serialize)]
    struct AdmissionPayload {
        file_name: String,
        student: Student,
        course: Course,
        branch: Branch,
    }

    #[derive(serde::Serialize)]
    struct ReceiptPayload {
        file_name: String,
        receipt: Receipt,
        student: Student,
        course: Course,
        branch: Branch,
    }

    #[derive(serde::Serialize)]
    struct ReceiptStagePayload {
        name: String,
        receipts: Vec<ReceiptPayload>,
    }

    #[derive(serde::Serialize)]
    struct OutstandingStagePayload {
        name: String,
        rows: Vec<OutstandingRow>,
    }

    #[derive(serde::Serialize)]
    struct PrintPayload {
        artifact_dir: String,
        admissions: Vec<AdmissionPayload>,
        receipt_stages: Vec<ReceiptStagePayload>,
        outstanding_stages: Vec<OutstandingStagePayload>,
    }

    fn total_years(course: &Course) -> i64 {
        if course.duration_type == "semester" {
            (course.duration + 1) / 2
        } else {
            course.duration
        }
    }

    fn total_periods(course: &Course) -> i64 {
        if course.duration_type == "semester" {
            course.duration
        } else {
            total_years(course) * 2
        }
    }

    fn course_year_from_period(period: i64) -> usize {
        ((period + 1) / 2).clamp(1, 4) as usize
    }

    fn annual_fee(course_index: usize, student_slot: usize, year: usize) -> f64 {
        12_000.0
            + (course_index as f64 * 200.0)
            + (student_slot as f64 * 20.0)
            + ((year.saturating_sub(1)) as f64 * 2_000.0)
    }

    fn student_request_for_course(
        course: &Course,
        course_index: usize,
        student_slot: usize,
        name: String,
    ) -> StudentRequest {
        let years = total_years(course) as usize;
        let fees = [
            if years >= 1 {
                annual_fee(course_index, student_slot, 1)
            } else {
                0.0
            },
            if years >= 2 {
                annual_fee(course_index, student_slot, 2)
            } else {
                0.0
            },
            if years >= 3 {
                annual_fee(course_index, student_slot, 3)
            } else {
                0.0
            },
            if years >= 4 {
                annual_fee(course_index, student_slot, 4)
            } else {
                0.0
            },
        ];

        StudentRequest {
            admission_date: "2026-09-01".into(),
            branch_id: course.branch_id.clone(),
            course_id: course.id.clone(),
            student_name: name,
            surname: format!("Flow{course_index:02}"),
            father_name: format!("Parent{student_slot}"),
            category: "General".into(),
            religion: "Hindu".into(),
            caste: "General".into(),
            gender: if student_slot == 1 { "Female" } else { "Male" }.into(),
            aadhar: format!("9000000000{course_index:02}{student_slot}"),
            address: "Regression Test Address".into(),
            district: "Sabarkantha".into(),
            taluka: "Test Taluka".into(),
            pincode: "383205".into(),
            student_phone: format!("900000{course_index:03}{student_slot}"),
            parent_phone: format!("910000{course_index:03}{student_slot}"),
            photo: String::new(),
            fee_year_1: fees[0],
            fee_year_2: fees[1],
            fee_year_3: fees[2],
            fee_year_4: fees[3],
            tuition_fee_year_1: Some(fees[0]),
            tuition_fee_year_2: Some(fees[1]),
            tuition_fee_year_3: Some(fees[2]),
            tuition_fee_year_4: Some(fees[3]),
            other_fee_year_1: Some(0.0),
            other_fee_year_2: Some(0.0),
            other_fee_year_3: Some(0.0),
            other_fee_year_4: Some(0.0),
            current_course_period: None,
        }
    }

    fn student_to_request(student: &Student) -> StudentRequest {
        StudentRequest {
            admission_date: student.admission_date.clone(),
            branch_id: student.branch_id.clone(),
            course_id: student.course_id.clone(),
            student_name: student.student_name.clone(),
            surname: student.surname.clone(),
            father_name: student.father_name.clone(),
            category: student.category.clone(),
            religion: student.religion.clone(),
            caste: student.caste.clone(),
            gender: student.gender.clone(),
            aadhar: student.aadhar.clone(),
            address: student.address.clone(),
            district: student.district.clone(),
            taluka: student.taluka.clone(),
            pincode: student.pincode.clone(),
            student_phone: student.student_phone.clone(),
            parent_phone: student.parent_phone.clone(),
            photo: student.photo.clone(),
            fee_year_1: student.fee_year_1,
            fee_year_2: student.fee_year_2,
            fee_year_3: student.fee_year_3,
            fee_year_4: student.fee_year_4,
            tuition_fee_year_1: Some(student.tuition_fee_year_1),
            tuition_fee_year_2: Some(student.tuition_fee_year_2),
            tuition_fee_year_3: Some(student.tuition_fee_year_3),
            tuition_fee_year_4: Some(student.tuition_fee_year_4),
            other_fee_year_1: Some(student.other_fee_year_1),
            other_fee_year_2: Some(student.other_fee_year_2),
            other_fee_year_3: Some(student.other_fee_year_3),
            other_fee_year_4: Some(student.other_fee_year_4),
            current_course_period: Some(student.current_course_period),
        }
    }

    fn set_year_fee(req: &mut StudentRequest, year: usize, fee: f64) {
        match year {
            1 => {
                req.fee_year_1 = fee;
                req.tuition_fee_year_1 = Some(fee);
                req.other_fee_year_1 = Some(0.0);
            }
            2 => {
                req.fee_year_2 = fee;
                req.tuition_fee_year_2 = Some(fee);
                req.other_fee_year_2 = Some(0.0);
            }
            3 => {
                req.fee_year_3 = fee;
                req.tuition_fee_year_3 = Some(fee);
                req.other_fee_year_3 = Some(0.0);
            }
            4 => {
                req.fee_year_4 = fee;
                req.tuition_fee_year_4 = Some(fee);
                req.other_fee_year_4 = Some(0.0);
            }
            _ => {}
        }
    }

    fn downloads_artifact_dir() -> Result<PathBuf, String> {
        let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
        let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
        Ok(PathBuf::from(home)
            .join("Downloads")
            .join(format!("GEWT-elaborate-flow-{stamp}")))
    }

    fn sanitize_file_part(value: &str) -> String {
        let mut out = String::new();
        for ch in value.chars() {
            if ch.is_ascii_alphanumeric() {
                out.push(ch);
            } else if matches!(ch, '-' | '_' | '.') {
                out.push(ch);
            } else if ch.is_whitespace() {
                out.push('-');
            }
        }
        if out.is_empty() {
            "untitled".to_string()
        } else {
            out
        }
    }

    fn write_file(path: &Path, content: &str) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(path, content).map_err(|e| e.to_string())
    }

    fn csv_escape(value: &str) -> String {
        format!("\"{}\"", value.replace('"', "\"\""))
    }

    async fn outstanding_rows_for_students(
        pool: &SqlitePool,
        student_ids: &[String],
    ) -> Result<Vec<OutstandingRow>, String> {
        let id_set: std::collections::HashSet<&str> =
            student_ids.iter().map(String::as_str).collect();
        Ok(db::outstanding(pool, None)
            .await?
            .into_iter()
            .filter(|row| id_set.contains(row.student.id.as_str()))
            .collect())
    }

    async fn pending_for_student(pool: &SqlitePool, student_id: &str) -> Result<f64, String> {
        Ok(db::outstanding(pool, None)
            .await?
            .into_iter()
            .find(|row| row.student.id == student_id)
            .map(|row| row.pending)
            .unwrap_or(0.0))
    }

    async fn promote_course_students(
        pool: &SqlitePool,
        course: &Course,
        flow_students: &[FlowStudent],
    ) -> Result<db::PromoteResponse, String> {
        let ids = flow_students
            .iter()
            .filter(|student| student.course_id == course.id)
            .map(|student| student.id.clone())
            .collect::<Vec<_>>();
        db::promote_students(
            pool,
            PromoteRequest {
                course_id: course.id.clone(),
                admission_year: 2026,
                student_ids: ids,
            },
        )
        .await
    }

    async fn save_pending_receipts(
        pool: &SqlitePool,
        stage: &str,
        date: &str,
        students: &[FlowStudent],
        courses_by_id: &HashMap<String, Course>,
        branches_by_id: &HashMap<String, Branch>,
    ) -> Result<ReceiptStagePayload, String> {
        let mut receipts = Vec::new();
        for flow_student in students {
            let pending = pending_for_student(pool, &flow_student.id).await?;
            if pending <= 0.0 {
                continue;
            }
            let student = db::load_student(pool, &flow_student.id).await?;
            let receipt = db::create_receipt(
                pool,
                ReceiptRequest {
                    student_id: student.id.clone(),
                    receipt_date: date.into(),
                    fee_type: "Tuition".into(),
                    amount_paid: pending,
                    payment_mode: "Cash".into(),
                    reference_no: None,
                },
                &student.branch_id,
                ADMIN,
            )
            .await?;
            let course = courses_by_id
                .get(&student.course_id)
                .ok_or_else(|| "Course missing for receipt payload".to_string())?
                .clone();
            let branch = branches_by_id
                .get(&student.branch_id)
                .ok_or_else(|| "Branch missing for receipt payload".to_string())?
                .clone();
            let file_name = format!(
                "{}-{}.html",
                sanitize_file_part(&receipt.receipt_no),
                sanitize_file_part(&student.form_no)
            );
            receipts.push(ReceiptPayload {
                file_name,
                receipt,
                student,
                course,
                branch,
            });
        }

        Ok(ReceiptStagePayload {
            name: stage.to_string(),
            receipts,
        })
    }

    fn run_app_print_renderer(repo_root: &Path, payload_path: &Path) -> Result<(), String> {
        let build_status = Command::new("bun")
            .args(["run", "build"])
            .current_dir(repo_root)
            .status()
            .map_err(|e| format!("Unable to run frontend build: {e}"))?;
        if !build_status.success() {
            return Err("Frontend build failed before print rendering".to_string());
        }

        let vitest = repo_root.join("node_modules/.bin/vitest");
        let render_status = Command::new(vitest)
            .args(["run", "src/test/elaborate-print-render.test.tsx"])
            .env("GEWT_PRINT_FLOW_INPUT", payload_path)
            .current_dir(repo_root)
            .status()
            .map_err(|e| format!("Unable to run print renderer: {e}"))?;
        if !render_status.success() {
            return Err("App print renderer failed".to_string());
        }

        Ok(())
    }

    async fn elaborate_fee_office_flow_run() -> Result<PathBuf, String> {
        let (_tmp, pool) = test_pool().await?;
        let artifact_dir = downloads_artifact_dir()?;
        std::fs::create_dir_all(&artifact_dir).map_err(|e| e.to_string())?;

        let branches = db::list_branches(&pool, None).await?;
        let branches_by_id: HashMap<String, Branch> = branches
            .iter()
            .cloned()
            .map(|branch| (branch.id.clone(), branch))
            .collect();
        let courses = db::list_courses(&pool, None, false).await?;
        assert_eq!(courses.len(), 18, "seeded active course catalog changed");

        let courses_by_id: HashMap<String, Course> = courses
            .iter()
            .cloned()
            .map(|course| (course.id.clone(), course))
            .collect();
        let mut flow_students = Vec::new();
        let mut admissions = Vec::new();
        let mut receipt_stages = Vec::new();
        let mut outstanding_stages = Vec::new();
        let mut manifest = String::from(
            "GEWT elaborate fee-office regression flow\n\nThis bundle is generated by the ignored Rust test `elaborate_fee_office_flow_with_saved_artifacts`.\n\n",
        );

        for (course_index, course) in courses.iter().enumerate() {
            let branch = branches_by_id
                .get(&course.branch_id)
                .ok_or_else(|| "Branch missing for course".to_string())?;
            for student_slot in 1..=2 {
                let req = student_request_for_course(
                    course,
                    course_index,
                    student_slot,
                    format!(
                        "Flow Student {} {}",
                        sanitize_file_part(&course.name),
                        student_slot
                    ),
                );
                let student = db::create_student(&pool, req, ADMIN).await?;
                let file_name = format!(
                    "{}-{}-{}.html",
                    sanitize_file_part(&branch.code),
                    sanitize_file_part(&course.name),
                    sanitize_file_part(&student.form_no)
                );
                admissions.push(AdmissionPayload {
                    file_name,
                    student: student.clone(),
                    course: course.clone(),
                    branch: branch.clone(),
                });
                flow_students.push(FlowStudent {
                    id: student.id,
                    course_id: course.id.clone(),
                    slot: student_slot,
                });
            }
        }
        let student_ids = flow_students
            .iter()
            .map(|student| student.id.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            flow_students.len(),
            courses.len() * 2,
            "two students should be admitted in every active course"
        );

        let after_admission = outstanding_rows_for_students(&pool, &student_ids).await?;
        assert_eq!(
            after_admission.len(),
            flow_students.len(),
            "new admissions should owe the first term/semester"
        );
        outstanding_stages.push(OutstandingStagePayload {
            name: "00 after admission before receipts".into(),
            rows: after_admission,
        });

        let period1_stage = save_pending_receipts(
            &pool,
            "01 period 1 receipts after admission",
            "2026-09-05",
            &flow_students,
            &courses_by_id,
            &branches_by_id,
        )
        .await?;
        assert_eq!(
            period1_stage.receipts.len(),
            flow_students.len(),
            "every admitted student should receive a period 1 receipt"
        );
        let period1_receipt_count = period1_stage.receipts.len();
        receipt_stages.push(period1_stage);
        let after_period1 = outstanding_rows_for_students(&pool, &student_ids).await?;
        assert!(
            after_period1.is_empty(),
            "period 1 receipts should clear first-period outstanding"
        );
        outstanding_stages.push(OutstandingStagePayload {
            name: "02 after period 1 receipts".into(),
            rows: after_period1,
        });

        for course in &courses {
            let response = promote_course_students(&pool, course, &flow_students).await?;
            assert_eq!(
                response.promoted_count, 2,
                "all courses should reach period 2"
            );
            assert_eq!(response.skipped_count, 0);
        }

        let period2_stage = save_pending_receipts(
            &pool,
            "03 period 2 receipts completing year 1",
            "2027-02-05",
            &flow_students,
            &courses_by_id,
            &branches_by_id,
        )
        .await?;
        assert_eq!(
            period2_stage.receipts.len(),
            flow_students.len(),
            "every student should receive the second receipt for year 1"
        );
        let period2_receipt_count = period2_stage.receipts.len();
        receipt_stages.push(period2_stage);
        let after_year1 = outstanding_rows_for_students(&pool, &student_ids).await?;
        assert!(
            after_year1.is_empty(),
            "two receipts should fully clear year 1"
        );
        outstanding_stages.push(OutstandingStagePayload {
            name: "04 after year 1 two receipts".into(),
            rows: after_year1,
        });

        for course in &courses {
            let response = promote_course_students(&pool, course, &flow_students).await?;
            if total_periods(course) > 2 {
                assert_eq!(
                    response.promoted_count, 2,
                    "eligible courses should reach period 3"
                );
                assert_eq!(response.skipped_count, 0);
            } else {
                assert_eq!(
                    response.promoted_count, 0,
                    "one-year courses should not promote past period 2"
                );
                assert_eq!(response.skipped_count, 2);
            }
        }

        let mut fee_change_log =
            String::from("stage,form_no,course,period,attempt,result,stored_fee\n");
        let period3_students = flow_students
            .iter()
            .filter(|student| {
                courses_by_id
                    .get(&student.course_id)
                    .map(|course| total_periods(course) > 2)
                    .unwrap_or(false)
            })
            .cloned()
            .collect::<Vec<_>>();
        for flow_student in period3_students.iter().filter(|student| student.slot == 1) {
            let student = db::load_student(&pool, &flow_student.id).await?;
            let current_year = course_year_from_period(student.current_course_period);
            assert_eq!(current_year, 2, "period 3 should be year 2");

            let mut locked_req = student_to_request(&student);
            set_year_fee(&mut locked_req, 1, student.fee_year_1 + 500.0);
            let locked = db::update_student(&pool, &student.id, locked_req).await;
            assert!(
                locked.is_err(),
                "completed year 1 fee should be locked after promotion to period 3"
            );

            let mut editable_req = student_to_request(&student);
            let new_fee = student.fee_year_2 + 2_000.0;
            set_year_fee(&mut editable_req, 2, new_fee);
            let updated = db::update_student(&pool, &student.id, editable_req).await?;
            assert_eq!(
                updated.fee_year_2, new_fee,
                "current year fee should be editable"
            );
            fee_change_log.push_str(&format!(
                "{},{},{},{},year1 locked and year2 changed,worked,{:.0}\n",
                csv_escape("05 after promotion to period 3"),
                csv_escape(&updated.form_no),
                csv_escape(&updated.course_name),
                updated.current_course_period,
                updated.fee_year_2
            ));
        }
        let after_period3_fee_change = outstanding_rows_for_students(&pool, &student_ids).await?;
        assert!(
            !after_period3_fee_change.is_empty(),
            "year 2 fee edits should create current-period outstanding"
        );
        outstanding_stages.push(OutstandingStagePayload {
            name: "05 after year 2 fee change before period 3 receipts".into(),
            rows: after_period3_fee_change,
        });

        let period3_stage = save_pending_receipts(
            &pool,
            "06 period 3 receipts after year 2 fee change",
            "2027-09-05",
            &period3_students,
            &courses_by_id,
            &branches_by_id,
        )
        .await?;
        assert_eq!(
            period3_stage.receipts.len(),
            period3_students.len(),
            "all period 3 students should receive a receipt"
        );
        let period3_receipt_count = period3_stage.receipts.len();
        receipt_stages.push(period3_stage);
        let after_period3_receipts = outstanding_rows_for_students(&pool, &student_ids).await?;
        assert!(
            after_period3_receipts.is_empty(),
            "period 3 receipts should clear outstanding"
        );
        outstanding_stages.push(OutstandingStagePayload {
            name: "07 after period 3 receipts".into(),
            rows: after_period3_receipts,
        });

        let period4_students = flow_students
            .iter()
            .filter(|student| {
                courses_by_id
                    .get(&student.course_id)
                    .map(|course| total_periods(course) > 3)
                    .unwrap_or(false)
            })
            .cloned()
            .collect::<Vec<_>>();
        for flow_student in period4_students.iter().filter(|student| student.slot == 2) {
            let student = db::load_student(&pool, &flow_student.id).await?;
            let mut req = student_to_request(&student);
            let new_fee = student.fee_year_2 + 3_000.0;
            set_year_fee(&mut req, 2, new_fee);
            let updated = db::update_student(&pool, &student.id, req).await?;
            assert_eq!(
                updated.fee_year_2, new_fee,
                "second current-year fee change should persist"
            );
            fee_change_log.push_str(&format!(
                "{},{},{},{},year2 changed again before period4,worked,{:.0}\n",
                csv_escape("08 before promotion to period 4"),
                csv_escape(&updated.form_no),
                csv_escape(&updated.course_name),
                updated.current_course_period,
                updated.fee_year_2
            ));
        }
        let after_second_fee_change = outstanding_rows_for_students(&pool, &student_ids).await?;
        outstanding_stages.push(OutstandingStagePayload {
            name: "08 after second year 2 fee change".into(),
            rows: after_second_fee_change,
        });

        for course in courses.iter().filter(|course| total_periods(course) > 3) {
            let response = promote_course_students(&pool, course, &flow_students).await?;
            assert_eq!(
                response.promoted_count, 2,
                "eligible courses should reach period 4"
            );
            assert_eq!(response.skipped_count, 0);
        }
        let period4_stage = save_pending_receipts(
            &pool,
            "09 period 4 receipts completing year 2",
            "2028-02-05",
            &period4_students,
            &courses_by_id,
            &branches_by_id,
        )
        .await?;
        assert_eq!(
            period4_stage.receipts.len(),
            period4_students.len(),
            "all period 4 students should receive a receipt"
        );
        let period4_receipt_count = period4_stage.receipts.len();
        receipt_stages.push(period4_stage);
        let after_year2 = outstanding_rows_for_students(&pool, &student_ids).await?;
        assert!(
            after_year2.is_empty(),
            "period 3 and period 4 receipts should clear year 2"
        );
        outstanding_stages.push(OutstandingStagePayload {
            name: "10 after year 2 four receipts".into(),
            rows: after_year2,
        });

        let period5_students = flow_students
            .iter()
            .filter(|student| {
                courses_by_id
                    .get(&student.course_id)
                    .map(|course| total_periods(course) > 4)
                    .unwrap_or(false)
            })
            .cloned()
            .collect::<Vec<_>>();
        for course in courses.iter().filter(|course| total_periods(course) > 4) {
            let response = promote_course_students(&pool, course, &flow_students).await?;
            assert_eq!(
                response.promoted_count, 2,
                "eligible courses should reach period 5"
            );
            assert_eq!(response.skipped_count, 0);
        }
        for flow_student in period5_students.iter().filter(|student| student.slot == 1) {
            let student = db::load_student(&pool, &flow_student.id).await?;
            let mut locked_req = student_to_request(&student);
            set_year_fee(&mut locked_req, 2, student.fee_year_2 + 500.0);
            let locked = db::update_student(&pool, &student.id, locked_req).await;
            assert!(
                locked.is_err(),
                "completed year 2 fee should lock after promotion to period 5"
            );

            let mut editable_req = student_to_request(&student);
            let new_fee = student.fee_year_3 + 4_000.0;
            set_year_fee(&mut editable_req, 3, new_fee);
            let updated = db::update_student(&pool, &student.id, editable_req).await?;
            assert_eq!(
                updated.fee_year_3, new_fee,
                "year 3 fee should remain editable at period 5"
            );
            fee_change_log.push_str(&format!(
                "{},{},{},{},year2 locked and year3 changed,worked,{:.0}\n",
                csv_escape("11 after promotion to period 5"),
                csv_escape(&updated.form_no),
                csv_escape(&updated.course_name),
                updated.current_course_period,
                updated.fee_year_3
            ));
        }
        let after_year3_fee_change = outstanding_rows_for_students(&pool, &student_ids).await?;
        outstanding_stages.push(OutstandingStagePayload {
            name: "11 after year 3 fee change before receipts".into(),
            rows: after_year3_fee_change,
        });

        write_file(
            &artifact_dir.join("fee-change-checkpoints.csv"),
            &fee_change_log,
        )?;

        manifest.push_str(&format!(
            "Admitted students: {}\nActive courses covered: {}\nPeriod 1 receipts: {}\nPeriod 2 receipts: {}\nPeriod 3 receipts: {}\nPeriod 4 receipts: {}\n\n",
            flow_students.len(),
            courses.len(),
            period1_receipt_count,
            period2_receipt_count,
            period3_receipt_count,
            period4_receipt_count,
        ));
        manifest.push_str(
            "Flow:\n\
             1. Admit two students in every active seeded course and save each admission form.\n\
             2. Save outstanding immediately after admission, before receipts.\n\
             3. Record period 1 receipts and verify outstanding clears.\n\
             4. Promote to period 2, record period 2 receipts, and save year-1 outstanding.\n\
             5. Promote eligible courses to period 3; verify one-year courses stop at period 2.\n\
             6. Verify year-1 fees are locked, change year-2 fees for selected students, and save outstanding.\n\
             7. Record period 3 receipts and verify outstanding clears.\n\
             8. Change year-2 fees again for selected students, promote to period 4, record receipts, and save year-2 outstanding.\n\
             9. Promote longer courses to period 5; verify year-2 fees are locked while year-3 fees remain editable, then save outstanding.\n",
        );
        manifest.push_str(
            "\nSaved documents are rendered through the app's React print components: AdmissionPrint, ReceiptPrint, and OutstandingPrint.\n",
        );
        write_file(&artifact_dir.join("00-flow-manifest.txt"), &manifest)?;

        let payload = PrintPayload {
            artifact_dir: artifact_dir.display().to_string(),
            admissions,
            receipt_stages,
            outstanding_stages,
        };
        let payload_path = artifact_dir.join("app-print-payload.json");
        let payload_json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
        write_file(&payload_path, &payload_json)?;

        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "Unable to locate repository root".to_string())?
            .to_path_buf();
        run_app_print_renderer(&repo_root, &payload_path)?;

        Ok(artifact_dir)
    }

    async fn run() -> Result<(), String> {
        let (tmp, pool) = test_pool().await?;

        let seeded_admin = db::authenticate(&pool, "irrn", "Ripal@1305").await?;
        assert_eq!(seeded_admin.name, "IRRN", "seeded admin name is stable");
        assert_eq!(seeded_admin.role, "admin", "seeded admin login works");

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
        let msw = prj_seed_courses
            .iter()
            .find(|course| course.name == "MSW")
            .unwrap();
        assert_eq!((msw.duration, msw.duration_type.as_str()), (4, "semester"));

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

        // Overpayment is rejected server-side: s1's annual tuition due is
        // 1000, with 500 still pending after the first receipt.
        let overpay = db::create_receipt(
            &pool,
            ReceiptRequest {
                student_id: s1.id.clone(),
                receipt_date: "2026-09-03".into(),
                fee_type: "Tuition".into(),
                amount_paid: 600.0,
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
                amount_paid: 1000.0,
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

        // Branch codes are fixed because they are embedded in issued document
        // numbers.
        let branch_update = db::update_branch_code(&pool, PRT, "PRX").await;
        assert!(
            branch_update.is_err(),
            "branch code updates must be blocked"
        );
        let s1_after = db::load_student(&pool, &s1.id).await?;
        assert_eq!(
            s1_after.form_no, "PRJ-1-2026",
            "form no remains on the canonical branch code"
        );
        let receipts_after = db::list_receipts(&pool, None, Some(&s1.id)).await?;
        assert!(
            receipts_after.iter().any(|r| r.receipt_no == "PRJ-1"),
            "receipt no remains on the canonical branch code"
        );

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
        let (_tmp, pool) = test_pool().await?;
        let course = db::create_course(&pool, course_req(PRT, "Fee Lock")).await?;
        let student = db::create_student(
            &pool,
            student_req(PRT, &course.id, "2026-09-01", 1000.0),
            ADMIN,
        )
        .await?;

        db::promote_students(
            &pool,
            PromoteRequest {
                course_id: course.id.clone(),
                admission_year: 2026,
                student_ids: vec![student.id.clone()],
            },
        )
        .await?;

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
        let current_year_fee = db::update_student(&pool, &student.id, current_year_fee_req).await?;
        assert_eq!(
            current_year_fee.fee_year_2, 1200.0,
            "current year fee remains editable"
        );

        Ok(())
    }

    fn employee_user_req(user_id: &str, branch: &str, password: &str) -> db::UserRequest {
        db::UserRequest {
            user_id: user_id.into(),
            name: format!("{user_id} user"),
            role: "employee".into(),
            branch_id: Some(branch.into()),
            password: Some(password.into()),
            active: true,
            can_admission: true,
            can_receipt: true,
            can_outstanding: true,
            can_students: true,
            can_promote: true,
        }
    }

    // Positive: an employee whose account only lives in the admin's backup can
    // provision a brand-new (pristine) device with NO login, then authenticate
    // as themselves — the "admin logs in on the employee's laptop" step is gone.
    async fn bootstrap_provisions_pristine_device_run() -> Result<(), String> {
        // Source machine: admin creates a PRT employee and some PRT data, then
        // exports the PRT branch as an admin backup.
        let (tmp, source) = test_pool().await?;
        db::create_user(&source, employee_user_req("prt_emp", PRT, "prtpass123")).await?;
        let course = db::create_course(&source, course_req(PRT, "Bootstrap Course")).await?;
        db::create_student(
            &source,
            student_req(PRT, &course.id, "2026-09-01", 1000.0),
            ADMIN,
        )
        .await?;
        let backup_file = tmp.join("bootstrap.gewtbak");
        backup::export_backup(&source, &[PRT.into()], "admin", &backup_file).await?;

        // Destination machine: a SEPARATE fresh pool with only the seed admin.
        let (_dest_tmp, dest) = test_pool().await?;
        assert!(
            db::is_pristine(&dest).await?,
            "a freshly seeded pool with only the seed admin is pristine"
        );
        assert!(
            db::authenticate(&dest, "prt_emp", "prtpass123").await.is_err(),
            "the employee cannot sign in before provisioning"
        );

        let summary = backup::bootstrap_import(&dest, &backup_file).await?;
        assert_eq!(summary.students, 1, "bootstrap import applied the student");

        // The employee can now authenticate with no prior admin login.
        let emp = db::authenticate(&dest, "prt_emp", "prtpass123").await?;
        assert_eq!(emp.role, "employee");
        assert_eq!(emp.branch_id.as_deref(), Some(PRT));

        // The seed admin is untouched (create-only never overwrote it).
        db::authenticate(&dest, "irrn", "Ripal@1305").await?;

        // Provisioning consumes pristineness, so a second unauthenticated import
        // would be refused by the command gate.
        assert!(
            !db::is_pristine(&dest).await?,
            "a provisioned device is no longer pristine"
        );

        Ok(())
    }

    // Negative #1: the gate that guards `bootstrap_from_backup`. A device with an
    // employee account or business data is not pristine, so the command rejects
    // the unauthenticated import ("This device is already set up.").
    async fn bootstrap_gate_rejects_non_pristine_run() -> Result<(), String> {
        let (_fresh_tmp, fresh) = test_pool().await?;
        assert!(
            db::is_pristine(&fresh).await?,
            "the fresh seed baseline is pristine"
        );

        let (_emp_tmp, with_employee) = test_pool().await?;
        db::create_user(&with_employee, employee_user_req("emp1", PRT, "pw123456")).await?;
        assert!(
            !db::is_pristine(&with_employee).await?,
            "an employee account makes the device non-pristine"
        );

        let (_data_tmp, with_data) = test_pool().await?;
        let course = db::create_course(&with_data, course_req(PRT, "Existing")).await?;
        db::create_student(
            &with_data,
            student_req(PRT, &course.id, "2026-09-01", 1000.0),
            ADMIN,
        )
        .await?;
        assert!(
            !db::is_pristine(&with_data).await?,
            "existing student business data makes the device non-pristine"
        );

        Ok(())
    }

    // Negative #2 (create-only): a bootstrap import must NEVER overwrite an
    // existing account's password hash — the guarantee against an offline
    // password-reset backdoor.
    async fn bootstrap_import_is_create_only_run() -> Result<(), String> {
        // Source: an employee whose backup password we do NOT want to win.
        let (tmp, source) = test_pool().await?;
        let backup_emp =
            db::create_user(&source, employee_user_req("shared", PRT, "backup_password")).await?;
        let backup_file = tmp.join("bootstrap-createonly.gewtbak");
        backup::export_backup(&source, &[PRT.into()], "admin", &backup_file).await?;

        // Destination already has an account with the SAME id but a different,
        // known password. (Forcing the shared id makes the import's INSERT OR
        // IGNORE collide on that exact row.)
        let (_dest_tmp, dest) = test_pool().await?;
        let local_emp =
            db::create_user(&dest, employee_user_req("shared", PRT, "original_password")).await?;
        sqlx::query("UPDATE users SET id = ? WHERE id = ?")
            .bind(&backup_emp.id)
            .bind(&local_emp.id)
            .execute(&dest)
            .await
            .map_err(|e| e.to_string())?;

        // Run the create-only apply directly (its safety does not depend on the
        // pristine gate — the gate lives in the command).
        backup::bootstrap_import(&dest, &backup_file).await?;

        assert!(
            db::authenticate(&dest, "shared", "original_password")
                .await
                .is_ok(),
            "create-only import must not overwrite an existing account's password"
        );
        assert!(
            db::authenticate(&dest, "shared", "backup_password")
                .await
                .is_err(),
            "the backup password must not have replaced the local one"
        );

        Ok(())
    }

    #[test]
    fn backend_access_helpers_enforce_employee_scope_test() {
        backend_access_helpers_enforce_employee_scope();
    }

    #[test]
    fn bootstrap_provisions_pristine_device() {
        tauri::async_runtime::block_on(bootstrap_provisions_pristine_device_run())
            .expect("bootstrap provisioning test failed");
    }

    #[test]
    fn bootstrap_gate_rejects_non_pristine() {
        tauri::async_runtime::block_on(bootstrap_gate_rejects_non_pristine_run())
            .expect("bootstrap pristine gate test failed");
    }

    #[test]
    fn bootstrap_import_is_create_only() {
        tauri::async_runtime::block_on(bootstrap_import_is_create_only_run())
            .expect("bootstrap create-only test failed");
    }

    #[test]
    fn completed_year_fee_lock() {
        tauri::async_runtime::block_on(completed_year_fee_lock_run())
            .expect("completed year fee lock test failed");
    }

    #[test]
    fn receipt_validation_and_fee_breakdown() {
        tauri::async_runtime::block_on(receipt_validation_and_fee_breakdown_run())
            .expect("receipt validation and fee breakdown test failed");
    }

    #[test]
    fn receipt_branch_must_match_student() {
        tauri::async_runtime::block_on(receipt_branch_must_match_student_run())
            .expect("receipt branch guard test failed");
    }

    #[test]
    fn student_fee_split_validation() {
        tauri::async_runtime::block_on(student_fee_split_validation_run())
            .expect("student fee split validation test failed");
    }

    #[test]
    fn fee_edit_cannot_drop_below_paid() {
        tauri::async_runtime::block_on(fee_edit_cannot_drop_below_paid_run())
            .expect("fee lowering guard test failed");
    }

    #[test]
    fn promotion_advances_one_year_and_stops_at_course_end() {
        tauri::async_runtime::block_on(promotion_advances_one_year_and_stops_at_course_end_run())
            .expect("promotion limit test failed");
    }

    #[test]
    fn academic_year_settings_affect_numbering() {
        tauri::async_runtime::block_on(academic_year_settings_affect_numbering_run())
            .expect("academic year settings test failed");
    }

    #[test]
    fn backup_import_rejects_cross_branch_payloads() {
        tauri::async_runtime::block_on(backup_import_rejects_cross_branch_payloads_run())
            .expect("backup import branch validation test failed");
    }

    #[test]
    fn cancelled_admission_is_hidden_and_zeroed() {
        tauri::async_runtime::block_on(cancelled_admission_is_hidden_and_zeroed_run())
            .expect("cancelled admission test failed");
    }

    #[test]
    fn course_branch_moves_respect_enrollment() {
        tauri::async_runtime::block_on(course_branch_moves_respect_enrollment_run())
            .expect("course branch move test failed");
    }

    #[test]
    fn outstanding_partial_payment_allocation() {
        tauri::async_runtime::block_on(outstanding_partial_payment_allocation_run())
            .expect("outstanding partial payment allocation test failed");
    }

    #[test]
    fn course_duration_is_capped() {
        tauri::async_runtime::block_on(course_duration_is_capped_run())
            .expect("course duration cap test failed");
    }

    #[test]
    fn legacy_current_course_year_column_is_dropped() {
        tauri::async_runtime::block_on(legacy_current_course_year_column_is_dropped_run())
            .expect("legacy current_course_year drop test failed");
    }

    #[test]
    #[ignore = "writes a full saved admission/receipt/outstanding artifact bundle to ~/Downloads"]
    fn elaborate_fee_office_flow_with_saved_artifacts() {
        let artifact_dir = tauri::async_runtime::block_on(elaborate_fee_office_flow_run())
            .expect("elaborate fee office flow failed");
        println!(
            "Saved elaborate GEWT flow artifacts to {}",
            artifact_dir.display()
        );
    }

    #[test]
    fn local_db_smoke() {
        tauri::async_runtime::block_on(run()).expect("smoke test failed");
    }
}

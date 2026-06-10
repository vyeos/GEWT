mod cache;

use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::RwLock;

const API_BASE: &str = "http://localhost:45123";
const DEFAULT_API_ADDR: &str = "127.0.0.1:45123";

struct CacheState {
    pool: SqlitePool,
    env_file: PathBuf,
    api_base: Arc<RwLock<String>>,
    api_started: Arc<AtomicBool>,
    api_error: Arc<RwLock<Option<String>>>,
}

#[derive(Debug, Serialize)]
struct SyncResult {
    synced_count: i64,
    is_initial: bool,
}

#[derive(Debug, Serialize)]
struct EnvConfigStatus {
    configured: bool,
    env_path: String,
    api_base: String,
    api_ready: bool,
    api_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EnvConfigInput {
    database_url: String,
    jwt_secret: String,
    api_addr: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct SyncPage<T> {
    data: Vec<T>,
    has_more: bool,
    next_cursor_updated_at: Option<String>,
    next_cursor_id: Option<String>,
    server_time: String,
}

#[tauri::command]
async fn sync_courses(
    state: tauri::State<'_, CacheState>,
    token: String,
    scope_key: String,
) -> Result<SyncResult, String> {
    let since = cache::get_last_synced(&state.pool, "courses", &scope_key)
        .await
        .map_err(|e| e.to_string())?;
    let is_initial = since.is_none();
    let client = reqwest::Client::new();
    let mut total_synced = 0i64;
    let mut until: Option<String> = None;
    let mut cursor_updated_at: Option<String> = None;
    let mut cursor_id: Option<String> = None;

    loop {
        let api_base = state.api_base.read().await.clone();
        let mut url = format!("{api_base}/sync/courses?limit=500");
        append_sync_params(&mut url, &since, &until, &cursor_updated_at, &cursor_id);

        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Sync failed ({status}): {body}"));
        }

        let sync_page: SyncPage<cache::CachedCourse> =
            resp.json().await.map_err(|e| e.to_string())?;

        until.get_or_insert_with(|| sync_page.server_time.clone());
        let count = sync_page.data.len() as i64;
        if count > 0 {
            cache::upsert_courses(&state.pool, &sync_page.data)
                .await
                .map_err(|e| e.to_string())?;
        }

        total_synced += count;

        if !sync_page.has_more {
            break;
        }
        cursor_updated_at = sync_page.next_cursor_updated_at;
        cursor_id = sync_page.next_cursor_id;
    }

    if let Some(server_time) = until {
        cache::set_last_synced(
            &state.pool,
            "courses",
            &scope_key,
            &server_time,
            total_synced,
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(SyncResult {
        synced_count: total_synced,
        is_initial,
    })
}

#[tauri::command]
async fn sync_students(
    state: tauri::State<'_, CacheState>,
    token: String,
    scope_key: String,
) -> Result<SyncResult, String> {
    let since = cache::get_last_synced(&state.pool, "students", &scope_key)
        .await
        .map_err(|e| e.to_string())?;
    let is_initial = since.is_none();
    let client = reqwest::Client::new();
    let mut total_synced = 0i64;
    let mut until: Option<String> = None;
    let mut cursor_updated_at: Option<String> = None;
    let mut cursor_id: Option<String> = None;

    loop {
        let api_base = state.api_base.read().await.clone();
        let mut url = format!("{api_base}/sync/students?limit=500");
        append_sync_params(&mut url, &since, &until, &cursor_updated_at, &cursor_id);

        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Sync failed ({status}): {body}"));
        }

        let sync_page: SyncPage<cache::CachedStudent> =
            resp.json().await.map_err(|e| e.to_string())?;

        until.get_or_insert_with(|| sync_page.server_time.clone());
        let count = sync_page.data.len() as i64;

        if count > 0 {
            cache::upsert_students(&state.pool, &sync_page.data)
                .await
                .map_err(|e| e.to_string())?;
        }

        total_synced += count;

        if !sync_page.has_more {
            break;
        }
        cursor_updated_at = sync_page.next_cursor_updated_at;
        cursor_id = sync_page.next_cursor_id;
    }

    if let Some(server_time) = until {
        cache::set_last_synced(
            &state.pool,
            "students",
            &scope_key,
            &server_time,
            total_synced,
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(SyncResult {
        synced_count: total_synced,
        is_initial,
    })
}

#[tauri::command]
async fn sync_receipts(
    state: tauri::State<'_, CacheState>,
    token: String,
    scope_key: String,
) -> Result<SyncResult, String> {
    let since = cache::get_last_synced(&state.pool, "receipts", &scope_key)
        .await
        .map_err(|e| e.to_string())?;
    let is_initial = since.is_none();
    let client = reqwest::Client::new();
    let mut total_synced = 0i64;
    let mut until: Option<String> = None;
    let mut cursor_updated_at: Option<String> = None;
    let mut cursor_id: Option<String> = None;

    loop {
        let api_base = state.api_base.read().await.clone();
        let mut url = format!("{api_base}/sync/receipts?limit=500");
        append_sync_params(&mut url, &since, &until, &cursor_updated_at, &cursor_id);

        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Sync failed ({status}): {body}"));
        }

        let sync_page: SyncPage<cache::CachedReceipt> =
            resp.json().await.map_err(|e| e.to_string())?;

        until.get_or_insert_with(|| sync_page.server_time.clone());
        let count = sync_page.data.len() as i64;

        if count > 0 {
            cache::upsert_receipts(&state.pool, &sync_page.data)
                .await
                .map_err(|e| e.to_string())?;
        }

        total_synced += count;

        if !sync_page.has_more {
            break;
        }
        cursor_updated_at = sync_page.next_cursor_updated_at;
        cursor_id = sync_page.next_cursor_id;
    }

    if let Some(server_time) = until {
        cache::set_last_synced(
            &state.pool,
            "receipts",
            &scope_key,
            &server_time,
            total_synced,
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(SyncResult {
        synced_count: total_synced,
        is_initial,
    })
}

#[tauri::command]
async fn get_cached_courses(
    state: tauri::State<'_, CacheState>,
    branch_id: Option<String>,
) -> Result<Vec<cache::CachedCourse>, String> {
    cache::get_courses(&state.pool, branch_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_cached_students(
    state: tauri::State<'_, CacheState>,
    branch_id: Option<String>,
) -> Result<Vec<cache::CachedStudent>, String> {
    cache::get_students(&state.pool, branch_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_cached_receipts(
    state: tauri::State<'_, CacheState>,
    student_id: Option<String>,
    branch_id: Option<String>,
) -> Result<Vec<cache::CachedReceipt>, String> {
    cache::get_receipts(&state.pool, student_id.as_deref(), branch_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cache_student(
    state: tauri::State<'_, CacheState>,
    mut student: serde_json::Value,
) -> Result<(), String> {
    if student.get("updated_at").is_none() {
        student["updated_at"] = serde_json::Value::String(chrono::Utc::now().to_rfc3339());
    }
    let parsed: cache::CachedStudent =
        serde_json::from_value(student).map_err(|e| e.to_string())?;
    cache::upsert_students(&state.pool, &[parsed])
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cache_receipt(
    state: tauri::State<'_, CacheState>,
    mut receipt: serde_json::Value,
) -> Result<(), String> {
    if receipt.get("updated_at").is_none() {
        receipt["updated_at"] = serde_json::Value::String(chrono::Utc::now().to_rfc3339());
    }
    let parsed: cache::CachedReceipt =
        serde_json::from_value(receipt).map_err(|e| e.to_string())?;
    cache::upsert_receipts(&state.pool, &[parsed])
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_sync_status(
    state: tauri::State<'_, CacheState>,
    scope_key: String,
) -> Result<serde_json::Value, String> {
    cache::get_sync_status(&state.pool, &scope_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reset_cache(state: tauri::State<'_, CacheState>) -> Result<(), String> {
    cache::reset_tables(&state.pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_env_config_status(
    state: tauri::State<'_, CacheState>,
) -> Result<EnvConfigStatus, String> {
    let mut status = env_config_status(&state.env_file).await?;
    if status.configured {
        status.api_ready = is_api_ready(&status.api_base).await;
        if status.api_ready {
            let mut current_api_error = state.api_error.write().await;
            *current_api_error = None;
            status.api_error = None;
        } else {
            let existing_error = state.api_error.read().await.clone();
            if existing_error.is_none() && !state.api_started.load(Ordering::SeqCst) {
                if let Err(error) = start_embedded_api(
                    state.env_file.clone(),
                    Arc::clone(&state.api_base),
                    Arc::clone(&state.api_started),
                    Arc::clone(&state.api_error),
                )
                .await
                {
                    status.api_error = Some(error);
                }
                status.api_ready = is_api_ready(&status.api_base).await;
            }

            if !status.api_ready && status.api_error.is_none() {
                status.api_error = state.api_error.read().await.clone();
            }
        }
    }
    Ok(status)
}

#[tauri::command]
async fn save_env_config(
    state: tauri::State<'_, CacheState>,
    input: EnvConfigInput,
) -> Result<EnvConfigStatus, String> {
    let database_url = input.database_url.trim();
    let jwt_secret = input.jwt_secret.trim();
    if database_url.is_empty() {
        return Err("DATABASE_URL is required".to_string());
    }
    if jwt_secret.is_empty() {
        return Err("JWT_SECRET is required".to_string());
    }

    let api_addr = normalize_api_addr(input.api_addr.as_deref())?;
    let body = format!(
        "DATABASE_URL={}\nJWT_SECRET={}\nAPI_ADDR={}\n",
        dotenv_quote(database_url),
        dotenv_quote(jwt_secret),
        dotenv_quote(&api_addr),
    );
    std::fs::write(&state.env_file, body).map_err(|e| e.to_string())?;

    let mut status = env_config_status(&state.env_file).await?;
    {
        let mut current_api_base = state.api_base.write().await;
        *current_api_base = status.api_base.clone();
    }
    start_embedded_api(
        state.env_file.clone(),
        Arc::clone(&state.api_base),
        Arc::clone(&state.api_started),
        Arc::clone(&state.api_error),
    )
    .await?;
    status.api_ready = is_api_ready(&status.api_base).await;
    status.api_error = if status.api_ready {
        None
    } else {
        state.api_error.read().await.clone()
    };

    Ok(status)
}

#[tauri::command]
async fn get_api_base(state: tauri::State<'_, CacheState>) -> Result<String, String> {
    Ok(state.api_base.read().await.clone())
}

/// Open the OS print dialog for the current page.
///
/// On Windows (WebView2) and Linux (WebKitGTK) JavaScript `window.print()`
/// works, so the frontend calls that directly there. macOS WKWebView ignores
/// `window.print()` entirely, so we drive the native WKWebView print operation
/// ourselves (mirrors what wry's `WebView::print` does internally).
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

    // Safety: `webview_ptr` is the live WKWebView handed to us by Tauri, and this
    // runs on the main thread (Tauri dispatches `with_webview` there), which is
    // required for AppKit print APIs.
    unsafe {
        let webview = &*(webview_ptr as *mut AnyObject);

        // Available macOS 11+; bail gracefully on anything older.
        let can_print: bool =
            msg_send![webview, respondsToSelector: sel!(printOperationWithPrintInfo:)];
        if !can_print {
            return;
        }

        let print_info: *mut AnyObject = msg_send![class!(NSPrintInfo), sharedPrintInfo];
        // Zero the paper margins so the page's own CSS (@page { margin: 0 } plus
        // the template's padding) controls the layout, matching the receipt.
        let _: () = msg_send![print_info, setTopMargin: 0.0_f64];
        let _: () = msg_send![print_info, setRightMargin: 0.0_f64];
        let _: () = msg_send![print_info, setBottomMargin: 0.0_f64];
        let _: () = msg_send![print_info, setLeftMargin: 0.0_f64];

        let operation: *mut AnyObject =
            msg_send![webview, printOperationWithPrintInfo: print_info];
        if operation.is_null() {
            return;
        }
        // Let the print panel run without blocking the main thread.
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

fn append_sync_params(
    url: &mut String,
    since: &Option<String>,
    until: &Option<String>,
    cursor_updated_at: &Option<String>,
    cursor_id: &Option<String>,
) {
    if let Some(s) = since {
        url.push_str(&format!("&since={}", urlencoding(s)));
    }
    if let Some(s) = until {
        url.push_str(&format!("&until={}", urlencoding(s)));
    }
    if let Some(s) = cursor_updated_at {
        url.push_str(&format!("&cursor_updated_at={}", urlencoding(s)));
    }
    if let Some(s) = cursor_id {
        url.push_str(&format!("&cursor_id={}", urlencoding(s)));
    }
}

fn urlencoding(s: &str) -> String {
    s.replace('+', "%2B").replace(':', "%3A")
}

async fn env_config_status(env_file: &Path) -> Result<EnvConfigStatus, String> {
    let env = read_env_file(env_file).unwrap_or_default();
    let configured = env
        .get("DATABASE_URL")
        .is_some_and(|value| !value.trim().is_empty())
        && env
            .get("JWT_SECRET")
            .is_some_and(|value| !value.trim().is_empty());
    let api_addr = env
        .get("API_ADDR")
        .map(String::as_str)
        .unwrap_or(DEFAULT_API_ADDR);
    let api_base = api_base_from_addr(api_addr)?;

    Ok(EnvConfigStatus {
        configured,
        env_path: env_file.display().to_string(),
        api_base,
        api_ready: false,
        api_error: None,
    })
}

fn read_env_file(env_file: &Path) -> Result<HashMap<String, String>, String> {
    if !env_file.exists() {
        return Ok(HashMap::new());
    }

    let mut env = HashMap::new();
    for item in dotenvy::from_path_iter(env_file).map_err(|e| e.to_string())? {
        let (key, value) = item.map_err(|e| e.to_string())?;
        env.insert(key, value);
    }
    Ok(env)
}

fn normalize_api_addr(api_addr: Option<&str>) -> Result<String, String> {
    let raw = api_addr
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_API_ADDR);
    raw.parse::<SocketAddr>()
        .map_err(|_| "API_ADDR must look like 127.0.0.1:45123".to_string())?;
    Ok(raw.to_string())
}

fn api_base_from_addr(api_addr: &str) -> Result<String, String> {
    let addr = normalize_api_addr(Some(api_addr))?;
    let socket_addr = addr
        .parse::<SocketAddr>()
        .map_err(|_| "API_ADDR must look like 127.0.0.1:45123".to_string())?;
    let host = match socket_addr.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST).to_string(),
        IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST).to_string(),
        IpAddr::V6(ip) => format!("[{ip}]"),
        ip => ip.to_string(),
    };
    Ok(format!("http://{host}:{}", socket_addr.port()))
}

fn dotenv_quote(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!("\"{escaped}\"")
}

async fn start_embedded_api(
    env_file: PathBuf,
    api_base: Arc<RwLock<String>>,
    api_started: Arc<AtomicBool>,
    api_error: Arc<RwLock<Option<String>>>,
) -> Result<(), String> {
    let status = env_config_status(&env_file).await?;
    if !status.configured {
        return Err("DATABASE_URL and JWT_SECRET must be configured first".to_string());
    }

    {
        let mut current_api_base = api_base.write().await;
        *current_api_base = status.api_base;
    }
    {
        let mut current_api_error = api_error.write().await;
        *current_api_error = None;
    }

    if api_started
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }

    let api_start_error = Arc::clone(&api_error);
    tauri::async_runtime::spawn(async move {
        if let Err(error) = gewt_api::run_with_env_file(Some(env_file)).await {
            let mut current_api_error = api_start_error.write().await;
            *current_api_error = Some(error.to_string());
            api_started.store(false, Ordering::SeqCst);
            eprintln!("GEWT API failed to start: {error:#}");
        }
    });

    let readiness_api_base = api_base.read().await.clone();
    let readiness_error = Arc::clone(&api_error);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        if !is_api_ready(&readiness_api_base).await {
            let mut current_api_error = readiness_error.write().await;
            if current_api_error.is_none() {
                *current_api_error = Some(
                    "GEWT API did not become ready. Check PostgreSQL is running and DATABASE_URL is reachable."
                        .to_string(),
                );
            }
        }
    });

    Ok(())
}

async fn is_api_ready(api_base: &str) -> bool {
    reqwest::Client::new()
        .get(format!("{api_base}/health"))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

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

    eprintln!(
        "GEWT update {} is available. Installing before API startup.",
        update.version
    );

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let update_installed = tauri::async_runtime::block_on(async {
                install_startup_update(app.handle()).await
            });
            if update_installed {
                app.handle().restart();
            }

            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            let env_file = config_dir.join(".env");

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let pool = tauri::async_runtime::block_on(async { cache::init_db(&data_dir).await })
                .map_err(|e| Box::new(std::io::Error::other(e.to_string())))?;

            let api_base = Arc::new(RwLock::new(API_BASE.to_string()));
            let api_started = Arc::new(AtomicBool::new(false));
            let api_error = Arc::new(RwLock::new(None));

            app.manage(CacheState {
                pool,
                env_file: env_file.clone(),
                api_base: Arc::clone(&api_base),
                api_started: Arc::clone(&api_started),
                api_error: Arc::clone(&api_error),
            });

            let should_start_api = tauri::async_runtime::block_on(async {
                env_config_status(&env_file)
                    .await
                    .map(|status| status.configured)
                    .unwrap_or(false)
            });
            if should_start_api {
                tauri::async_runtime::block_on(async {
                    start_embedded_api(env_file, api_base, api_started, api_error).await
                })
                .map_err(|e| Box::new(std::io::Error::other(e)))?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_env_config_status,
            save_env_config,
            get_api_base,
            print_page,
            sync_courses,
            sync_students,
            sync_receipts,
            get_cached_courses,
            get_cached_students,
            get_cached_receipts,
            cache_student,
            cache_receipt,
            get_sync_status,
            reset_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

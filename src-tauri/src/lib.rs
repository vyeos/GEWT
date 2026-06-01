mod cache;

use serde::Serialize;
use sqlx::sqlite::SqlitePool;
use tauri::Manager;

const API_BASE: &str = "http://localhost:45123";

struct CacheState {
    pool: SqlitePool,
}

#[derive(Debug, Serialize)]
struct SyncResult {
    synced_count: i64,
    is_initial: bool,
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
        let mut url = format!("{API_BASE}/sync/courses?limit=500");
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
        let mut url = format!("{API_BASE}/sync/students?limit=500");
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
        let mut url = format!("{API_BASE}/sync/receipts?limit=500");
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            let env_file = config_dir.join(".env");

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let pool = tauri::async_runtime::block_on(async { cache::init_db(&data_dir).await })
                .map_err(|e| Box::new(std::io::Error::other(e.to_string())))?;

            app.manage(CacheState { pool });

            tauri::async_runtime::spawn(async move {
                if let Err(error) = gewt_api::run_with_env_file(Some(env_file)).await {
                    eprintln!("GEWT API failed to start: {error:#}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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

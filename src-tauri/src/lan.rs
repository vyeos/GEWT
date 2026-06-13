//! Per-machine LAN pointer.
//!
//! When the app is in "LAN mode", every machine on the network points at a
//! single shared `gewt.db` living in a network folder instead of each machine's
//! own copy in the app-data dir. The pointer to that folder is **per-machine
//! local config** stored next to the local data — it can never live inside the
//! shared DB it selects (chicken-and-egg). Absence of the file (the default, and
//! every existing install) means normal local mode, unchanged.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Default)]
struct LanConfig {
    /// Folder holding the shared `gewt.db`. `None`/absent = local mode.
    db_dir: Option<String>,
}

fn config_file(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("lan.json")
}

/// The configured shared-DB folder, or `None` for normal local mode.
pub fn read_lan_dir(app_data_dir: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(config_file(app_data_dir)).ok()?;
    let config: LanConfig = serde_json::from_str(&raw).ok()?;
    config
        .db_dir
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
}

/// Point this machine at a shared folder (`Some`) or back to local (`None`).
/// The change takes effect on the next launch.
pub fn write_lan_dir(app_data_dir: &Path, dir: Option<&Path>) -> Result<(), String> {
    let config = LanConfig {
        db_dir: dir.map(|d| d.display().to_string()),
    };
    let raw = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(config_file(app_data_dir), raw).map_err(|e| e.to_string())
}

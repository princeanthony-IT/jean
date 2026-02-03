use std::collections::HashMap;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use tauri::AppHandle;

use super::claude::CancelledEvent;
use super::run_log;
use super::storage;
use crate::http_server::EmitExt;

/// Global registry of running Claude process PIDs by session_id
/// Allows cancellation of in-progress chat requests via SIGKILL
/// Key is session_id (not worktree_id) to support multiple concurrent sessions per worktree
static PROCESS_REGISTRY: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Register a running Claude process PID for a session
pub fn register_process(session_id: String, pid: u32) {
    let mut registry = PROCESS_REGISTRY.lock().unwrap();
    log::trace!("Registering Claude process pid={pid} for session: {session_id}");
    log::trace!(
        "Registry state before insert: {:?}",
        registry.keys().collect::<Vec<_>>()
    );
    registry.insert(session_id, pid);
}

/// Remove a process from the registry (called after completion or cancellation)
pub fn unregister_process(session_id: &str) {
    let mut registry = PROCESS_REGISTRY.lock().unwrap();
    if let Some(pid) = registry.remove(session_id) {
        log::trace!("Unregistered Claude process {pid} for session: {session_id}");
    }
}

/// Check if a session has a running process
#[allow(dead_code)]
pub fn is_process_running(session_id: &str) -> bool {
    PROCESS_REGISTRY.lock().unwrap().contains_key(session_id)
}

/// Get all session IDs that currently have running processes
pub fn get_running_sessions() -> Vec<String> {
    PROCESS_REGISTRY.lock().unwrap().keys().cloned().collect()
}

/// Cancel a running Claude process for a session by sending SIGKILL to the process group
/// Returns true if a process was found and signal sent, false otherwise
///
/// SAFETY: We kill the entire process group (negative PID) to ensure all child processes
/// spawned by Claude CLI are also terminated. This is safe because:
/// 1. Claude is spawned with process_group(0), creating a NEW group separate from Jean
/// 2. We guard against dangerous PIDs (0, 1) that could affect system processes
pub fn cancel_process(
    app: &AppHandle,
    session_id: &str,
    worktree_id: &str,
) -> Result<bool, String> {
    let mut registry = PROCESS_REGISTRY.lock().unwrap();
    log::trace!("cancel_process called for session: {session_id}");
    log::trace!("Registry state: {:?}", registry.iter().collect::<Vec<_>>());

    if let Some(pid) = registry.remove(session_id) {
        // SAFETY: Never kill PID 0 (would kill our own process group) or PID 1 (init/launchd)
        if pid == 0 || pid == 1 {
            log::error!("Refusing to kill dangerous PID: {pid}");
            return Err(format!("Invalid PID: {pid}"));
        }

        log::trace!("Cancelling Claude process group {pid} for session: {session_id}");

        // Kill the entire process tree to ensure child processes are also terminated
        // Uses platform-specific implementation from the platform module
        use crate::platform::{is_process_alive, kill_process, kill_process_tree};

        log::trace!("Killing process tree for pid={pid}");

        // First, check if the process exists
        if !is_process_alive(pid) {
            log::warn!("Process {pid} check failed (may have exited)");
        } else {
            log::trace!("Process {pid} exists, proceeding with kill");
        }

        // Kill the process tree (process group on Unix, taskkill /T on Windows)
        if let Err(e) = kill_process_tree(pid) {
            log::error!("Failed to kill process tree for pid={pid}: {e}");
        } else {
            log::trace!("Successfully sent kill to process tree pid={pid}");
        }

        // Also try killing the process directly as fallback
        if let Err(e) = kill_process(pid) {
            log::trace!("Direct kill of pid={pid} failed (may be redundant): {e}");
        } else {
            log::trace!("Direct kill of pid={pid} succeeded");
        }

        // Update manifest SYNCHRONOUSLY before emitting event
        // This ensures any frontend refetch sees "Cancelled" status, not "Running"
        if let Err(e) = run_log::mark_running_run_cancelled(app, session_id) {
            log::warn!("Failed to mark run as cancelled in manifest: {e}");
        }

        // Emit cancelled event for responsive UI
        let event = CancelledEvent {
            session_id: session_id.to_string(),
            worktree_id: worktree_id.to_string(),
            undo_send: false, // Process was running, may have partial content
        };
        if let Err(e) = app.emit_all("chat:cancelled", &event) {
            log::error!("Failed to emit chat:cancelled event: {e}");
        }

        Ok(true)
    } else {
        log::trace!("No running process found for session: {session_id}");
        Ok(false)
    }
}

/// Cancel all running Claude processes for a given worktree
/// Called before worktree deletion to clean up orphaned processes
pub fn cancel_processes_for_worktree(app: &AppHandle, worktree_id: &str) {
    log::trace!("Cancelling all Claude processes for worktree: {worktree_id}");

    // Load sessions for this worktree from app data directory
    match storage::load_sessions_by_id(app, worktree_id) {
        Ok(sessions) => {
            let mut cancelled_count = 0;
            for session in &sessions.sessions {
                if let Ok(true) = cancel_process(app, &session.id, worktree_id) {
                    cancelled_count += 1;
                }
            }
            if cancelled_count > 0 {
                log::trace!(
                    "Cancelled {cancelled_count} Claude process(es) for worktree: {worktree_id}"
                );
            }
        }
        Err(e) => {
            // Not an error - worktree may have no sessions yet
            log::trace!("No sessions found for worktree {worktree_id}: {e}");
        }
    }
}

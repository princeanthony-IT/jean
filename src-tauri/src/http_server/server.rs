use axum::{
    extract::{ws::WebSocketUpgrade, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use super::auth;
use super::websocket::handle_ws_connection;
use super::WsBroadcaster;

/// Shared state for the Axum server.
#[derive(Clone)]
struct AppState {
    app: AppHandle,
    token: String,
}

/// Server handle for shutdown coordination.
pub struct HttpServerHandle {
    pub shutdown_tx: tokio::sync::oneshot::Sender<()>,
    pub port: u16,
    pub token: String,
    pub url: String,
    pub localhost_only: bool,
}

/// Status response for the HTTP server.
#[derive(Serialize, Clone)]
pub struct ServerStatus {
    pub running: bool,
    pub url: Option<String>,
    pub token: Option<String>,
    pub port: Option<u16>,
    pub localhost_only: Option<bool>,
}

#[derive(Deserialize)]
struct WsAuth {
    token: Option<String>,
}

/// Resolve the dist directory path at runtime.
/// Checks multiple locations for development and production scenarios.
fn resolve_dist_path(app: &AppHandle) -> std::path::PathBuf {
    // 1. Check if app has a resource dir with dist/
    if let Ok(resource_dir) = app.path().resource_dir() {
        let dist = resource_dir.join("dist");
        if dist.exists() && dist.join("index.html").exists() {
            log::info!("Serving frontend from resource dir: {}", dist.display());
            return dist;
        }
    }

    // 2. Development: relative to cargo manifest dir
    let dev_dist = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if dev_dist.exists() && dev_dist.join("index.html").exists() {
        log::info!("Serving frontend from dev dist: {}", dev_dist.display());
        return dev_dist;
    }

    // 3. Fallback: relative to executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let dist = parent.join("dist");
            if dist.exists() && dist.join("index.html").exists() {
                log::info!("Serving frontend from exe-relative dist: {}", dist.display());
                return dist;
            }
        }
    }

    // Last resort: return dev path even if it doesn't exist yet
    log::warn!("No dist directory found with index.html, using dev path: {}", dev_dist.display());
    dev_dist
}

/// Start the HTTP + WebSocket server.
pub async fn start_server(
    app: AppHandle,
    port: u16,
    token: String,
    localhost_only: bool,
) -> Result<HttpServerHandle, String> {
    let state = AppState {
        app: app.clone(),
        token: token.clone(),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Resolve the dist directory at runtime for static file serving
    let dist_path = resolve_dist_path(&app);
    let index_path = dist_path.join("index.html");

    let serve_dir = ServeDir::new(&dist_path)
        .append_index_html_on_directories(true)
        .fallback(ServeFile::new(&index_path));

    let router = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/auth", get(auth_handler))
        .route("/api/init", get(init_handler))
        .fallback_service(serve_dir)
        .layer(cors)
        .with_state(state);

    // Bind to localhost only or all interfaces based on preference
    let addr = if localhost_only {
        SocketAddr::from(([127, 0, 0, 1], port))
    } else {
        SocketAddr::from(([0, 0, 0, 0], port))
    };
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind to port {port}: {e}"))?;

    let local_addr = listener.local_addr()
        .map_err(|e| format!("Failed to get local address: {e}"))?;

    // Get LAN IP for the URL (only used when not localhost-only)
    let ip = if localhost_only {
        "127.0.0.1".to_string()
    } else {
        get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string())
    };
    let url = format!("http://{ip}:{}", local_addr.port());

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();

    // Spawn the server
    tokio::spawn(async move {
        log::info!("HTTP server listening on {local_addr} (localhost_only: {localhost_only})");
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
                log::info!("HTTP server shutting down");
            })
            .await
            .unwrap_or_else(|e| log::error!("HTTP server error: {e}"));
    });

    Ok(HttpServerHandle {
        shutdown_tx,
        port: local_addr.port(),
        token,
        url,
        localhost_only,
    })
}

/// WebSocket upgrade handler with token auth.
async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsAuth>,
    State(state): State<AppState>,
) -> Response {
    // Validate token
    let provided = params.token.unwrap_or_default();
    if !auth::validate_token(&provided, &state.token) {
        return (StatusCode::UNAUTHORIZED, "Invalid token").into_response();
    }

    // Get broadcast receiver for this client
    let broadcaster = state.app.try_state::<WsBroadcaster>();
    let event_rx = match broadcaster {
        Some(b) => b.subscribe(),
        None => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Server not initialized").into_response();
        }
    };

    let app = state.app.clone();
    ws.on_upgrade(move |socket| handle_ws_connection(socket, app, event_rx))
}

/// Token validation endpoint. Returns 200 with { ok: true } on success,
/// or 401 with { ok: false, error: "..." } on failure.
async fn auth_handler(
    Query(params): Query<WsAuth>,
    State(state): State<AppState>,
) -> Response {
    let provided = params.token.unwrap_or_default();
    if auth::validate_token(&provided, &state.token) {
        Json(serde_json::json!({ "ok": true })).into_response()
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "ok": false, "error": "Invalid token" })),
        )
            .into_response()
    }
}

/// Initial data endpoint. Returns all data needed to render the initial view.
/// This is used by the web view to preload data before WebSocket connects.
async fn init_handler(
    Query(params): Query<WsAuth>,
    State(state): State<AppState>,
) -> Response {
    // Validate token
    let provided = params.token.unwrap_or_default();
    if !auth::validate_token(&provided, &state.token) {
        return (StatusCode::UNAUTHORIZED, "Invalid token").into_response();
    }

    // Fetch base data in parallel
    let (projects_result, preferences_result, ui_state_result) = tokio::join!(
        crate::projects::list_projects(state.app.clone()),
        crate::load_preferences(state.app.clone()),
        crate::load_ui_state(state.app.clone()),
    );

    // Build response object with available data (don't fail if one part fails)
    let mut response = serde_json::json!({});

    // Extract projects and fetch worktrees for each
    let projects = match projects_result {
        Ok(projects) => projects,
        Err(e) => {
            log::error!("Failed to load projects for /api/init: {e}");
            vec![]
        }
    };

    // Fetch worktrees for all projects in parallel
    let worktrees_futures: Vec<_> = projects
        .iter()
        .filter(|p| !p.is_folder) // Only fetch worktrees for actual projects
        .map(|p| {
            let app = state.app.clone();
            let project_id = p.id.clone();
            async move {
                let worktrees = crate::projects::list_worktrees(app, project_id.clone())
                    .await
                    .unwrap_or_default();
                (project_id, worktrees)
            }
        })
        .collect();

    let worktrees_by_project: std::collections::HashMap<String, Vec<crate::projects::types::Worktree>> =
        futures_util::future::join_all(worktrees_futures)
            .await
            .into_iter()
            .collect();

    // Collect all worktrees for session/status fetching
    let all_worktrees: Vec<_> = worktrees_by_project
        .values()
        .flat_map(|wts| wts.iter())
        .collect();

    // Fetch sessions for all worktrees in parallel
    let sessions_futures: Vec<_> = all_worktrees
        .iter()
        .map(|wt| {
            let app = state.app.clone();
            let worktree_id = wt.id.clone();
            let worktree_path = wt.path.clone();
            async move {
                let sessions = crate::chat::get_sessions(
                    app,
                    worktree_id.clone(),
                    worktree_path,
                    None,  // include_archived
                    Some(true),  // include_message_counts
                )
                .await
                .unwrap_or_default();
                (worktree_id, sessions)
            }
        })
        .collect();

    // WorktreeSessions contains the full struct - keep as-is for frontend compatibility
    let sessions_by_worktree: std::collections::HashMap<String, crate::chat::types::WorktreeSessions> =
        futures_util::future::join_all(sessions_futures)
            .await
            .into_iter()
            .collect();

    // Note: Git status is already included in the Worktree struct (cached_* fields)
    // No need to fetch separately - the frontend will use worktree.cached_* values

    // Extract ui_state early so we can use it to fetch active sessions
    let ui_state = match &ui_state_result {
        Ok(ui_state) => Some(ui_state.clone()),
        Err(_) => None,
    };

    // Fetch full session details (with messages) for all active sessions
    // This ensures the chat history is immediately available when the app loads
    let active_sessions: std::collections::HashMap<String, crate::chat::types::Session> = if let Some(ref ui) = ui_state {
        // Build a map of worktree_id -> worktree for path lookup
        let worktree_map: std::collections::HashMap<&str, &crate::projects::types::Worktree> =
            all_worktrees.iter().map(|wt| (wt.id.as_str(), *wt)).collect();

        // Fetch full session details for each active session
        let session_futures: Vec<_> = ui.active_session_ids
            .iter()
            .filter_map(|(worktree_id, session_id)| {
                worktree_map.get(worktree_id.as_str()).map(|wt| {
                    let app = state.app.clone();
                    let wt_id = worktree_id.clone();
                    let wt_path = wt.path.clone();
                    let sess_id = session_id.clone();
                    async move {
                        match crate::chat::get_session(app, wt_id, wt_path, sess_id.clone()).await {
                            Ok(session) => Some((sess_id, session)),
                            Err(e) => {
                                log::warn!("Failed to load active session {sess_id}: {e}");
                                None
                            }
                        }
                    }
                })
            })
            .collect();

        futures_util::future::join_all(session_futures)
            .await
            .into_iter()
            .flatten()
            .collect()
    } else {
        std::collections::HashMap::new()
    };

    // Serialize projects
    if let Ok(val) = serde_json::to_value(&projects) {
        response["projects"] = val;
    }

    // Serialize worktrees map (projectId -> worktrees[])
    if let Ok(val) = serde_json::to_value(&worktrees_by_project) {
        response["worktreesByProject"] = val;
    }

    // Serialize sessions map (worktreeId -> WorktreeSessions)
    if let Ok(val) = serde_json::to_value(&sessions_by_worktree) {
        response["sessionsByWorktree"] = val;
    }

    // Serialize active sessions map (sessionId -> Session with messages)
    if !active_sessions.is_empty() {
        if let Ok(val) = serde_json::to_value(&active_sessions) {
            response["activeSessions"] = val;
        }
    }

    match preferences_result {
        Ok(preferences) => {
            if let Ok(val) = serde_json::to_value(&preferences) {
                response["preferences"] = val;
            }
        }
        Err(e) => {
            log::error!("Failed to load preferences for /api/init: {e}");
            response["preferences"] = Value::Null;
        }
    }

    match ui_state_result {
        Ok(ui_state) => {
            if let Ok(val) = serde_json::to_value(&ui_state) {
                response["uiState"] = val;
            }
        }
        Err(e) => {
            log::error!("Failed to load ui_state for /api/init: {e}");
            response["uiState"] = Value::Null;
        }
    }

    Json(response).into_response()
}

/// Get the local LAN IP address.
fn get_local_ip() -> Option<String> {
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

/// Get current server status. Called from dispatch.
pub async fn get_server_status(app: AppHandle) -> ServerStatus {
    match app.try_state::<Arc<Mutex<Option<HttpServerHandle>>>>() {
        Some(handle_state) => {
            let handle = handle_state.lock().await;
            match handle.as_ref() {
                Some(h) => ServerStatus {
                    running: true,
                    url: Some(h.url.clone()),
                    token: Some(h.token.clone()),
                    port: Some(h.port),
                    localhost_only: Some(h.localhost_only),
                },
                None => ServerStatus {
                    running: false,
                    url: None,
                    token: None,
                    port: None,
                    localhost_only: None,
                },
            }
        }
        None => ServerStatus {
            running: false,
            url: None,
            token: None,
            port: None,
            localhost_only: None,
        },
    }
}

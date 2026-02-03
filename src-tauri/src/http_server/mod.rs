pub mod auth;
pub mod dispatch;
pub mod server;
pub mod websocket;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast;

/// Broadcast channel for sending events to all connected WebSocket clients.
/// Managed as Tauri state so any code with an AppHandle can broadcast.
pub struct WsBroadcaster {
    tx: broadcast::Sender<WsEvent>,
}

#[derive(Clone, Debug)]
pub struct WsEvent {
    pub event: String,
    pub payload: Value,
}

impl WsBroadcaster {
    pub fn new() -> (Self, broadcast::Sender<WsEvent>) {
        // Buffer 1000 events — slow clients will miss old events
        let (tx, _) = broadcast::channel(1000);
        let tx_clone = tx.clone();
        (Self { tx }, tx_clone)
    }

    pub fn broadcast(&self, event: &str, payload: &Value) {
        // Ignore send errors (no active receivers is fine)
        let _ = self.tx.send(WsEvent {
            event: event.to_string(),
            payload: payload.clone(),
        });
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WsEvent> {
        self.tx.subscribe()
    }
}

/// Extension trait on AppHandle that sends to both Tauri IPC and WebSocket clients.
/// Use `app.emit_all("event", &payload)` instead of `app.emit("event", &payload)`.
pub trait EmitExt {
    fn emit_all<S: Serialize + Clone>(&self, event: &str, payload: &S) -> Result<(), String>;
}

impl EmitExt for AppHandle {
    fn emit_all<S: Serialize + Clone>(&self, event: &str, payload: &S) -> Result<(), String> {
        // Send to Tauri frontend (native app)
        self.emit(event, payload.clone())
            .map_err(|e| format!("Tauri emit failed: {e}"))?;

        // Broadcast to WebSocket clients (if server is running)
        if let Some(ws) = self.try_state::<WsBroadcaster>() {
            let value = serde_json::to_value(payload)
                .map_err(|e| format!("Failed to serialize for WS broadcast: {e}"))?;
            ws.broadcast(event, &value);
        }

        Ok(())
    }
}

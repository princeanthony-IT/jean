use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tokio::sync::broadcast;

use super::dispatch::dispatch_command;
use super::WsEvent;

#[derive(Deserialize)]
struct InvokeRequest {
    id: String,
    command: String,
    #[serde(default)]
    args: Value,
}

#[derive(Serialize)]
struct InvokeResponse {
    #[serde(rename = "type")]
    msg_type: String,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
struct EventMessage {
    #[serde(rename = "type")]
    msg_type: String,
    event: String,
    payload: Value,
}

/// Handle a single WebSocket connection.
/// Reads invoke requests, dispatches to command handlers, writes responses.
/// Also forwards broadcast events to the client.
pub async fn handle_ws_connection(
    socket: WebSocket,
    app: AppHandle,
    mut event_rx: broadcast::Receiver<WsEvent>,
) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Spawn a task to forward broadcast events to this client
    let (client_tx, mut client_rx) = tokio::sync::mpsc::channel::<String>(256);

    let event_forwarder = tokio::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(ws_event) => {
                    let msg = EventMessage {
                        msg_type: "event".to_string(),
                        event: ws_event.event,
                        payload: ws_event.payload,
                    };
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if client_tx.send(json).await.is_err() {
                            break; // Client disconnected
                        }
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    log::warn!("WS client lagged, skipped {n} events");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Main loop: handle incoming messages and outgoing events
    loop {
        tokio::select! {
            // Incoming message from client
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let app_clone = app.clone();
                        // Parse and dispatch
                        match serde_json::from_str::<InvokeRequest>(&text) {
                            Ok(req) => {
                                let id = req.id.clone();
                                match dispatch_command(&app_clone, &req.command, req.args).await {
                                    Ok(data) => {
                                        let resp = InvokeResponse {
                                            msg_type: "response".to_string(),
                                            id,
                                            data: Some(data),
                                            error: None,
                                        };
                                        if let Ok(json) = serde_json::to_string(&resp) {
                                            if ws_tx.send(Message::Text(json.into())).await.is_err() {
                                                break;
                                            }
                                        }
                                    }
                                    Err(err) => {
                                        let resp = InvokeResponse {
                                            msg_type: "error".to_string(),
                                            id,
                                            data: None,
                                            error: Some(err),
                                        };
                                        if let Ok(json) = serde_json::to_string(&resp) {
                                            if ws_tx.send(Message::Text(json.into())).await.is_err() {
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                let resp = InvokeResponse {
                                    msg_type: "error".to_string(),
                                    id: "unknown".to_string(),
                                    data: None,
                                    error: Some(format!("Invalid request: {e}")),
                                };
                                if let Ok(json) = serde_json::to_string(&resp) {
                                    if ws_tx.send(Message::Text(json.into())).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(data))) => {
                        if ws_tx.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    _ => {} // Ignore binary, pong
                }
            }
            // Outgoing event from broadcast
            Some(json) = client_rx.recv() => {
                if ws_tx.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
    }

    event_forwarder.abort();
    log::trace!("WebSocket client disconnected");
}

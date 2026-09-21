use super::profile::{ApiResult, Protocol, StoredProfile};
use super::stream::{MAX_RESPONSE, SseDecoder};
use reqwest::{Client, header::{HeaderValue, AUTHORIZATION, ACCEPT, CONTENT_TYPE}};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use tokio::sync::{mpsc, watch};

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Frame { Event { data: String }, Json { data: String }, Done, Error { code: &'static str } }

pub fn validate_payload(profile: &StoredProfile, payload: &Value) -> ApiResult<()> {
    let p = payload.as_object().ok_or("invalid_request")?;
    let allowed = ["model", "messages", "input", "instructions", "system", "stream", "store", "include", "tools",
        "max_tokens", "max_completion_tokens", "max_output_tokens", "stream_options", "tool_choice"];
    if p.keys().any(|k| !allowed.contains(&k.as_str())) || p.get("model").and_then(Value::as_str) != Some(&profile.settings.model)
        || p.get("stream").and_then(Value::as_bool) != Some(profile.settings.stream) { return Err("invalid_request"); }
    if p.get("store").is_some_and(|v| v != &Value::Bool(false)) { return Err("invalid_request"); }
    for key in ["max_tokens", "max_completion_tokens", "max_output_tokens"] {
        if p.get(key).is_some_and(|v| v.as_u64() != Some(u64::from(profile.settings.max_tokens))) { return Err("invalid_request"); }
    }
    if let Some(tools) = p.get("tools") {
        let tools = tools.as_array().ok_or("invalid_request")?;
        for tool in tools {
            // Never enable upstream computer, shell, file search, remote MCP or
            // other server-side tools via a model's returned payload.
            let obj = tool.as_object().ok_or("invalid_request")?;
            if profile.settings.protocol == Protocol::Anthropic {
                if obj.keys().any(|k| !["name", "description", "input_schema"].contains(&k.as_str())) { return Err("invalid_request"); }
            } else if obj.get("type").and_then(Value::as_str) != Some("function") { return Err("invalid_request"); }
        }
    }
    Ok(())
}

pub async fn perform(profile: StoredProfile, payload: Value, tx: mpsc::Sender<Frame>, stop: watch::Receiver<bool>) {
    let idle = Duration::from_secs(u64::from(profile.settings.timeout_seconds));
    perform_with_deadlines(profile, payload, tx, stop, idle, Duration::from_secs(2 * 60 * 60)).await;
}

/// Settings control inactivity, not the total length of an actively streaming
/// answer. The independent hard deadline also bounds heartbeat-only streams
/// and an unresponsive WebView consumer. Smaller clocks are used by tests only.
pub(super) async fn perform_with_deadlines(profile: StoredProfile, payload: Value, tx: mpsc::Sender<Frame>, mut stop: watch::Receiver<bool>, idle: Duration, hard: Duration) {
    let task = async {
        validate_payload(&profile, &payload)?;
        let body = serde_json::to_vec(&payload).map_err(|_| "invalid_request")?;
        if body.len() > super::MAX_REQUEST { return Err("request_too_large"); }
        let body_len = body.len();
        let endpoint = profile.settings.validate()?;
        let host = endpoint.host_str().unwrap_or("unknown").to_string();
        let client = Client::builder().redirect(reqwest::redirect::Policy::none()).referer(false).no_proxy()
            .connect_timeout(Duration::from_secs(15)).build().map_err(|_| "network_error")?;
        let mut request = client.post(endpoint).header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, if profile.settings.stream { "text/event-stream" } else { "application/json" }).body(body);
        if !profile.key.is_empty() {
            let mut value = HeaderValue::from_str(&if profile.settings.protocol == Protocol::Anthropic {
                profile.key.clone()
            } else { format!("Bearer {}", profile.key) }).map_err(|_| "invalid_api_key")?;
            value.set_sensitive(true);
            request = if profile.settings.protocol == Protocol::Anthropic { request.header("x-api-key", value) }
                else { request.header(AUTHORIZATION, value) };
        }
        if profile.settings.protocol == Protocol::Anthropic { request = request.header("anthropic-version", "2023-06-01"); }
        let mut response = tokio::time::timeout(idle, request.send()).await.map_err(|_| "request_timeout")?
            .map_err(|e| if e.is_timeout() { "request_timeout" } else { "network_error" })?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            // Useful diagnostics without exposing request/response bodies,
            // headers, credentials or the full endpoint URL.
            let tool_count = payload.get("tools").and_then(Value::as_array).map_or(0, Vec::len);
            let turn_items = payload.get("messages").or_else(|| payload.get("input")).and_then(Value::as_array).map_or(0, Vec::len);
            eprintln!("ai.api.http_error status={} host={} model={} request_bytes={} tools={} turn_items={}",
                status, host, profile.settings.model, body_len, tool_count, turn_items);
            return Err(match status { 300..=399 => "redirect_blocked", 401 => "authentication_failed", 403 => "access_denied",
                404 => "endpoint_or_model_missing", 429 => "rate_or_quota_limit", 400 | 422 => "provider_rejected_request",
                500 => "provider_internal_error", 502 => "provider_bad_gateway", 503 | 529 => "provider_overloaded",
                504 => "provider_gateway_timeout", 501 | 505..=599 => "provider_unavailable", _ => "http_error" });
        }
        if response.content_length().is_some_and(|n| n > MAX_RESPONSE as u64) { return Err("response_too_large"); }
        let mime = response.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("").trim();
        let streaming = mime == "text/event-stream";
        if !streaming && mime != "application/json" { return Err("invalid_content_type"); }
        if streaming != profile.settings.stream { return Err("stream_mode_mismatch"); }
        let mut decoder = SseDecoder::default(); let mut json = Vec::new();
        while let Some(chunk) = tokio::time::timeout(idle, response.chunk()).await.map_err(|_| "request_timeout")?
            .map_err(|e| if e.is_timeout() { "request_timeout" } else { "stream_disconnected" })? {
            if streaming {
                for data in decoder.feed(&chunk)? { tx.send(Frame::Event { data }).await.map_err(|_| "cancelled")?; }
            } else {
                if json.len() + chunk.len() > MAX_RESPONSE { return Err("response_too_large"); }
                json.extend_from_slice(&chunk);
            }
        }
        if streaming { decoder.finish()?; }
        else { tx.send(Frame::Json { data: String::from_utf8(json).map_err(|_| "invalid_utf8")? }).await.map_err(|_| "cancelled")?; }
        Ok::<(), &'static str>(())
    };
    let result = tokio::select! {
        biased;
        _ = stop.changed() => return,
        result = tokio::time::timeout(hard, task) => result.unwrap_or(Err("request_deadline")),
    };
    let frame = match result { Ok(()) => Frame::Done, Err(code) => Frame::Error { code } };
    tokio::select! { biased; _ = stop.changed() => {}, _ = tokio::time::timeout(Duration::from_secs(5), tx.send(frame)) => {} }
}

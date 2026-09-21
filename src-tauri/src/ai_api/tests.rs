use super::{network::{self, Frame}, profile::*, stream::*};
use serde_json::json;
use std::{io::{Read, Write}, net::TcpListener, sync::mpsc as std_mpsc, time::Duration};
use tokio::sync::{mpsc, watch};

fn settings() -> Settings { Settings { protocol: Protocol::Chat, endpoint: "https://example.test/v1/chat/completions".into(),
    model: "fixture".into(), stream: true, tools: true, include_usage: true, chat_token_field: "max_tokens".into(),
    max_tokens: 2048, timeout_seconds: 15, allow_local_http: false } }
fn body(profile: &StoredProfile) -> serde_json::Value { json!({ "model":profile.settings.model,"stream":profile.settings.stream,
    "messages":[{"role":"user","content":"synthetic fixture"}],"max_tokens":profile.settings.max_tokens }) }

#[test]
fn endpoints_are_explicit_and_no_credential_bearing_url_or_public_http() {
    for endpoint in ["https://example.test/v1/responses", "https://127.0.0.1:443/custom"] { let mut s = settings(); s.endpoint = endpoint.into(); assert!(s.validate().is_ok()); }
    for endpoint in ["http://example.test/api", "https://key:secret@example.test", "https://example.test/?key=secret",
        "https://example.test/#secret", "file:///tmp/code", "ftp://example.test", "http://127.0.0.1:8888/api"] {
        let mut s = settings(); s.endpoint = endpoint.into(); assert!(s.validate().is_err());
    }
    for endpoint in ["http://127.0.0.1:8888/api", "http://[::1]/api", "http://192.168.1.5/api"] {
        let mut s = settings(); s.endpoint = endpoint.into(); s.allow_local_http = true; assert!(s.validate().is_ok());
    }
    let mut s = settings(); s.endpoint = "http://evil.test/api".into(); s.allow_local_http = true; assert!(s.validate().is_err());
}
#[test]
fn settings_and_secret_are_bounded_and_header_injection_is_rejected() {
    let mut profile = StoredProfile { settings: settings(), key: "fixture-key".into() }; assert!(profile.validate().is_ok());
    profile.key = "key\r\nx-evil: value".into(); assert!(profile.validate().is_err());
    profile.key = "x".repeat(2049); assert!(profile.validate().is_err());
    profile.key.clear(); assert!(profile.validate().is_ok());
    profile.settings.timeout_seconds = 0; assert!(profile.validate().is_err());
}
#[test]
fn sse_all_utf8_chunk_boundaries_and_crlf_multiline_comments() {
    let text = "\u{feff}:comment\r\nevent: hello\r\ndata: {\"text\":\"中文😀\",\r\ndata: \"ok\":true}\r\n\r\ndata: [DONE]\n\n";
    for size in 1..=text.len() {
        let mut parser = SseDecoder::default(); let mut out = vec![];
        for chunk in text.as_bytes().chunks(size) { out.extend(parser.feed(chunk).unwrap()); }
        parser.finish().unwrap(); assert_eq!(out, ["{\"text\":\"中文😀\",\n\"ok\":true}", "[DONE]"]);
    }
}
#[test]
fn sse_rejects_truncated_events_bad_utf8_and_oversized_lines() {
    let mut parser = SseDecoder::default(); parser.feed(b"data: {\"half\":1}\n").unwrap(); assert!(parser.finish().is_err());
    assert!(SseDecoder::default().feed(b"data: \xff\n\n").is_err());
    assert!(SseDecoder::default().feed(&vec![b'a'; MAX_EVENT + 1]).is_err());
    let mut parser = SseDecoder::default(); let chunk = b":x\n\n".repeat(256 * 1024);
    for _ in 0..MAX_RESPONSE/chunk.len() { parser.feed(&chunk).unwrap(); }
    assert!(parser.feed(b"x").is_err());
}
#[test]
fn model_transport_ceilings_are_process_guards_not_normal_workflow_caps() {
    assert!(MAX_RESPONSE >= 64 * 1024 * 1024);
    assert!(MAX_EVENT >= 16 * 1024 * 1024);
    assert!(super::MAX_REQUEST >= 64 * 1024 * 1024);
}
#[test]
fn outbound_payload_cannot_choose_model_background_storage_or_server_tools() {
    let profile = StoredProfile { settings: settings(), key: String::new() };
    assert!(network::validate_payload(&profile, &body(&profile)).is_ok());
    for (key, value) in [("model", json!("other")), ("store", json!(true)), ("background", json!(true)),
        ("max_tokens", json!(9999999)), ("tools", json!([{"type":"computer_use"}]))] {
        let mut value_body = body(&profile); value_body[key] = value; assert!(network::validate_payload(&profile, &value_body).is_err());
    }
}

#[test]
fn kept_key_is_bound_to_exact_endpoint_and_protocol() {
    let old = StoredProfile { settings: settings(), key: "synthetic-test-key".into() };
    assert_eq!(super::prepare_profile(settings(), None, Some(&old)).unwrap().key, old.key);
    let mut next = settings(); next.endpoint = "https://another.invalid/v1/messages".into();
    assert!(matches!(super::prepare_profile(next.clone(), None, Some(&old)), Err("endpoint_change_requires_key")));
    assert_eq!(super::prepare_profile(next, Some(String::new()), Some(&old)).unwrap().key, "");
    let mut next = settings(); next.protocol = Protocol::Anthropic;
    assert!(matches!(super::prepare_profile(next, None, Some(&old)), Err("endpoint_change_requires_key")));
}
#[tokio::test]
async fn reset_revokes_profile_incarnation_even_when_profile_mutex_is_owned() {
    use std::sync::atomic::Ordering;
    let state = super::ApiState::default(); let mut profile = state.profile.lock().await;
    *profile = Some(super::Active { profile: StoredProfile { settings: settings(), key: "test".into() },
        view: ProfileView { revision:"old".into(), settings:settings(), has_key:true, remembered:false }, lifecycle:0 });
    state.reset(); assert_ne!(profile.as_ref().unwrap().lifecycle, state.lifecycle.load(Ordering::Acquire));
    drop(profile); state.reset(); assert!(state.profile.lock().await.is_none());
}
#[tokio::test]
async fn cancellation_does_not_reclaim_concurrency_until_network_task_exits() {
    let state = super::ApiState::default();
    let first = state.slots.clone().try_acquire_owned().unwrap(); let second = state.slots.clone().try_acquire_owned().unwrap();
    state.cancel_all(); assert!(state.slots.clone().try_acquire_owned().is_err());
    drop(first); assert!(state.slots.clone().try_acquire_owned().is_ok()); drop(second);
}

#[tokio::test]
async fn old_stream_completion_must_not_remove_replacement_request() {
    use std::sync::Arc;
    let state = super::ApiState::default(); let (tx, rx) = mpsc::channel(4); let (stop, _) = watch::channel(false);
    state.jobs.lock().unwrap().insert("same".into(),Arc::new(super::Job { rx:tokio::sync::Mutex::new(rx), stop }));
    let (_, rx2) = mpsc::channel(4); let (stop2, _) = watch::channel(false);
    let replacement = Arc::new(super::Job { rx:tokio::sync::Mutex::new(rx2), stop:stop2 });
    let (old, ()) = tokio::join!(state.next_frame("same"),async {
        tokio::task::yield_now().await;
        state.jobs.lock().unwrap().insert("same".into(),replacement.clone());tx.send(Frame::Done).await.unwrap();
    });
    assert!(matches!(old,Err("request_closed")),"old request may not deliver a replacement's completion");
    assert!(Arc::ptr_eq(state.jobs.lock().unwrap().get("same").unwrap(),&replacement));
}

#[test]
fn saved_configuration_is_versioned_bounded_and_secret_bound() {
    let profile = StoredProfile { settings: settings(), key: "synthetic".into() };
    let encoded = encode_saved(&profile).unwrap();let decoded = decode_saved(&encoded).unwrap();
    assert_eq!(decoded.key,profile.key);assert_eq!(decoded.settings.endpoint,profile.settings.endpoint);
    assert!(decode_saved(&encoded.replace("\"version\":1","\"version\":2")).is_err());
    assert!(decode_saved(&" ".repeat(2401)).is_err());
    let v = ProfileView {revision:"rev".into(),settings:settings(),has_key:true,remembered:true};
    let public = serde_json::to_string(&v).unwrap();assert!(!public.contains("synthetic"));assert!(!public.contains("\"key\":"));
}

// Each test peer is this test's ephemeral loopback socket, never a provider.
fn peer(status: u16, mime: &'static str, content: &'static [u8], location: Option<String>, hold: bool)
    -> (String, std_mpsc::Receiver<String>, std::thread::JoinHandle<()>) {
    let socket = TcpListener::bind("127.0.0.1:0").unwrap(); let address = socket.local_addr().unwrap();
    let (tx, rx) = std_mpsc::channel();
    let thread = std::thread::spawn(move || {
        let (mut stream, _) = socket.accept().unwrap(); stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let mut request = Vec::new(); let mut buf = [0u8; 2048];
        while !request.windows(4).any(|s| s == b"\r\n\r\n") { let n = stream.read(&mut buf).unwrap(); if n == 0 { break; } request.extend_from_slice(&buf[..n]); }
        tx.send(String::from_utf8_lossy(&request).to_string()).unwrap();
        let extra = location.map(|url| format!("Location: {url}\r\n")).unwrap_or_default();
        let _ = write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: {mime}\r\nContent-Length: {}\r\n{extra}Connection: close\r\n\r\n", if hold { content.len()+999 } else { content.len() });
        let _ = stream.write_all(content);
        if hold { std::thread::sleep(Duration::from_millis(350)); }
    });
    (format!("http://{address}/v1/chat/completions"), rx, thread)
}
async fn run_peer(status: u16, mime: &'static str, content: &'static [u8], location: Option<String>, cancel: bool) -> (Vec<Frame>, String) {
    let (url, requests, thread) = peer(status, mime, content, location, cancel);
    let mut s = settings(); s.endpoint = url; s.allow_local_http = true;
    let p = StoredProfile { settings: s, key: "fixture-never-real".into() }; let payload = body(&p);
    let (tx, mut rx) = mpsc::channel(4); let (stop, signal) = watch::channel(false);
    let task = tokio::spawn(network::perform(p, payload, tx, signal));
    if cancel { tokio::time::sleep(Duration::from_millis(100)).await; stop.send(true).unwrap(); }
    let mut frames = Vec::new(); while let Some(f) = rx.recv().await { frames.push(f); }
    tokio::time::timeout(Duration::from_secs(2), task).await.unwrap().unwrap();
    thread.join().unwrap(); (frames, requests.recv().unwrap())
}
#[tokio::test]
async fn real_http_sse_and_credentials_stay_in_headers_only() {
    let (frames, request) = run_peer(200, "text/event-stream", b"data: [DONE]\n\n", None, false).await;
    assert!(matches!(frames.as_slice(), [Frame::Event { .. }, Frame::Done]));
    assert!(request.to_lowercase().contains("authorization: bearer fixture-never-real"));
    assert!(!serde_json::to_string(&frames).unwrap().contains("fixture-never-real"));
}
#[tokio::test]
async fn redirect_is_not_followed_and_errors_never_echo_bodies() {
    for (status, code) in [
        (302,"redirect_blocked"), (401,"authentication_failed"), (429,"rate_or_quota_limit"),
        (500,"provider_internal_error"), (502,"provider_bad_gateway"), (503,"provider_overloaded"),
        (504,"provider_gateway_timeout"), (529,"provider_overloaded"), (520,"provider_unavailable")
    ] {
        let (frames, _) = run_peer(status, "application/json", b"secret key and path must not escape", Some("http://127.0.0.1:1/stolen".into()), false).await;
        assert!(matches!(frames.as_slice(), [Frame::Error { code: c }] if *c == code));
    }
}
#[tokio::test]
async fn cancel_releases_stalled_response_and_incomplete_streams_are_not_success() {
    let (frames, _) = run_peer(200, "text/event-stream", b"data: {", None, true).await; assert!(frames.is_empty());
    let (frames, _) = run_peer(200, "text/event-stream", b"data: {", None, false).await;
    assert!(matches!(frames.as_slice(), [Frame::Error { code: "stream_incomplete" }]));
}
#[test]
#[ignore = "writes and removes only a unique synthetic test entry in the OS credential store"]
fn private_os_vault_roundtrip() {
    let store = OsVault(format!("tradeflow.test.{}", super::revision().unwrap()));
    // Diagnose this fresh synthetic entry only. Never enumerate credentials or
    // print an existing password. The production command still uses fixed codes.
    let entry = keyring::Entry::new(&format!("{}.ai-api", store.0), "active-profile-v1").unwrap();
    if let Err(error) = entry.get_password() {
        if !matches!(error, keyring::Error::NoEntry) { eprintln!("Synthetic OS-vault access: {error}"); }
    }
    let profile = StoredProfile { settings: settings(), key: "synthetic-test-only-not-a-user-key".into() };
    assert!(store.load().unwrap().is_none()); store.save(Some(&profile)).unwrap();
    let restored = store.load().unwrap().unwrap(); assert_eq!(restored.key, profile.key);
    assert_eq!(restored.settings.endpoint, profile.settings.endpoint); store.save(None).unwrap(); assert!(store.load().unwrap().is_none());
}

async fn timed_stream(heartbeat: bool, finish: bool, idle: u64, hard: u64) -> Vec<Frame> {
    let socket = TcpListener::bind("127.0.0.1:0").unwrap(); let address = socket.local_addr().unwrap();
    let thread = std::thread::spawn(move || {
        let (mut stream, _) = socket.accept().unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let mut request = Vec::new(); let mut buf = [0u8; 2048];
        while !request.windows(4).any(|s| s == b"\r\n\r\n") {
            let n = stream.read(&mut buf).unwrap(); if n == 0 { return; } request.extend_from_slice(&buf[..n]);
        }
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").unwrap();
        for _ in 0..10 {
            if heartbeat && stream.write_all(b": keep-alive\n\n").is_err() { return; }
            std::thread::sleep(Duration::from_millis(60));
        }
        if finish { let _ = stream.write_all(b"data: [DONE]\n\n"); }
    });
    let mut s = settings(); s.endpoint = format!("http://{address}/test"); s.allow_local_http = true;
    let profile = StoredProfile { settings: s, key: "synthetic".into() }; let payload = body(&profile);
    let (tx, mut rx) = mpsc::channel(4); let (_stop, signal) = watch::channel(false);
    let task = tokio::spawn(network::perform_with_deadlines(profile, payload, tx, signal, Duration::from_millis(idle), Duration::from_millis(hard)));
    let mut frames = vec![];
    tokio::time::timeout(Duration::from_secs(3), async { while let Some(frame) = rx.recv().await { frames.push(frame); } }).await.unwrap();
    task.await.unwrap(); thread.join().unwrap(); frames
}

#[tokio::test]
async fn continuous_heartbeats_can_outlive_idle_timeout_and_complete() {
    // 600ms total, longer than the 250ms idle clock. SSE comments count as
    // transport progress without becoming model text or tool instructions.
    let frames = timed_stream(true, true, 250, 2000).await;
    assert!(matches!(frames.as_slice(), [Frame::Event { .. }, Frame::Done]));
}

#[tokio::test]
async fn silent_response_still_times_out_and_heartbeats_cannot_run_forever() {
    let frames = timed_stream(false, false, 250, 2000).await;
    assert!(matches!(frames.as_slice(), [Frame::Error { code: "request_timeout" }]));
    let frames = timed_stream(true, false, 250, 350).await;
    assert!(matches!(frames.as_slice(), [Frame::Error { code: "request_deadline" }]));
}

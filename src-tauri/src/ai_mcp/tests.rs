use super::{broker::{BridgeEvent, Broker}, wire};
use std::io::{self, BufRead, BufReader, Cursor, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::{Arc, atomic::{AtomicBool, Ordering}, mpsc};
use std::time::Duration;

fn test_broker(callback: impl Fn(BridgeEvent) -> bool + Send + Sync + 'static) -> Arc<Broker> {
    Broker::start_with_token(Arc::new(callback), "a".repeat(64)).unwrap()
}

#[test]
fn tools_changed_is_fixed_coalesced_and_does_not_consume_a_request_reply() {
    let (tx, rx) = mpsc::channel();
    let broker = test_broker(move |e| tx.send(e).is_ok());
    let (mut socket, mut reader) = paired(&broker);
    let opened = rx.recv_timeout(Duration::from_secs(2)).unwrap();
    socket.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"ping\"}\n").unwrap();
    let request = rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let job = broker.reserve_tools_changed(&opened.connection_id).unwrap().unwrap();
    assert!(broker.reserve_tools_changed(&opened.connection_id).unwrap().is_none());
    job.send().unwrap();
    let stop = AtomicBool::new(false);
    let notification = wire::read_line(&mut reader, 256, &stop, Duration::from_secs(2)).unwrap().unwrap();
    assert_eq!(serde_json::from_str::<serde_json::Value>(&notification).unwrap(),
        serde_json::json!({"jsonrpc":"2.0","method":"notifications/tools/list_changed"}));
    broker.finish(&opened.connection_id, request.sequence, Some("{\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{}}".into())).unwrap();
    assert!(wire::read_line(&mut reader, 256, &stop, Duration::from_secs(2)).unwrap().unwrap().contains("\"id\":7"));
    // A dropped unsent reservation cannot permanently suppress future notifications.
    drop(broker.reserve_tools_changed(&opened.connection_id).unwrap().unwrap());
    assert!(broker.reserve_tools_changed(&opened.connection_id).unwrap().is_some());
    assert!(broker.reserve_tools_changed("unknown-peer").is_err());
    broker.stop();
    assert!(broker.reserve_tools_changed(&opened.connection_id).is_err()); wait_stopped(&broker);
}

#[test]
fn wire_is_bounded_utf8_newline_only() {
    let stop = AtomicBool::new(false);
    let mut input = Cursor::new("中文\nsecond\r\n");
    assert_eq!(wire::read_line(&mut input, 6, &stop, Duration::from_secs(1)).unwrap().unwrap(), "中文");
    assert_eq!(wire::read_line(&mut input, 6, &stop, Duration::from_secs(1)).unwrap().unwrap(), "second");
    assert!(wire::read_line(&mut Cursor::new(b"abcdefg\n"), 6, &stop, Duration::from_secs(1)).is_err());
    assert!(wire::read_line(&mut Cursor::new(b"\xff\n"), 6, &stop, Duration::from_secs(1)).is_err());
    assert!(wire::read_line(&mut Cursor::new(b"partial"), 9, &stop, Duration::from_secs(1)).is_err());
}

#[test]
fn idle_nonblocking_reader_does_not_spin() {
    struct IdleReader { attempts: usize }
    impl Read for IdleReader {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> { Err(io::ErrorKind::WouldBlock.into()) }
    }
    impl BufRead for IdleReader {
        fn fill_buf(&mut self) -> io::Result<&[u8]> {
            self.attempts += 1;
            Err(io::ErrorKind::WouldBlock.into())
        }
        fn consume(&mut self, _: usize) {}
    }

    let mut reader = IdleReader { attempts: 0 };
    let stop = AtomicBool::new(false);
    let result = wire::read_line(&mut reader, 16, &stop, Duration::from_millis(50));
    assert_eq!(result.unwrap_err().kind(), io::ErrorKind::TimedOut);
    assert!(reader.attempts <= 20, "idle socket was polled {} times", reader.attempts);
}
#[test]
fn indicator_source_frame_fits_but_wire_budget_is_still_enforced() {
    let stop = AtomicBool::new(false);
    let line = format!("{{\"source\":\"{}\"}}\n", "a".repeat(256 * 1024));
    let parsed = wire::read_line(&mut Cursor::new(&line), wire::REQUEST_BYTES, &stop, Duration::from_secs(1)).unwrap().unwrap();
    assert_eq!(parsed.len(), line.len() - 1);
    let oversized = format!("{}\n", "a".repeat(wire::REQUEST_BYTES + 1));
    assert!(wire::read_line(&mut Cursor::new(oversized), wire::REQUEST_BYTES, &stop, Duration::from_secs(1)).is_err());
}

#[test]
fn no_empty_short_or_mismatched_token() {
    let token = "a".repeat(64);
    assert!(wire::token_matches(&token, &token));
    for candidate in ["".into(), "a".repeat(63), "b".repeat(64), "a".repeat(65)] { assert!(!wire::token_matches(&token, &candidate)); }
}
#[test]
fn real_private_socket_auth_frame_reply_revoke_and_release() {
    let (tx, rx) = mpsc::channel();
    let broker = test_broker(move |e| tx.send(e).is_ok());
    let config = broker.config("unused".into(), "/tmp/mcp-runtime-v1.json".into());
    let mut socket = TcpStream::connect(broker.address()).unwrap();
    socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    let mut reader = BufReader::new(socket.try_clone().unwrap());
    writeln!(socket, "{}", serde_json::json!({"version":1,"token":config.token})).unwrap();
    let stop = AtomicBool::new(false);
    assert_eq!(wire::read_line(&mut reader, 100, &stop, Duration::from_secs(2)).unwrap().unwrap(), "{\"ready\":1}");
    let opened = rx.recv_timeout(Duration::from_secs(2)).unwrap(); assert_eq!(opened.kind, "opened");
    socket.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n").unwrap();
    let message = rx.recv_timeout(Duration::from_secs(2)).unwrap(); assert_eq!(message.kind, "message");
    let text = "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}";
    broker.finish(&message.connection_id, message.sequence, Some(text.into())).unwrap();
    assert_eq!(wire::read_line(&mut reader, 100, &stop, Duration::from_secs(2)).unwrap().unwrap(), text);
    assert!(broker.finish(&message.connection_id, message.sequence, Some(text.into())).is_err());
    broker.disconnect(&message.connection_id);
    assert!(wire::read_line(&mut reader, 100, &stop, Duration::from_secs(2)).unwrap().is_none());
    broker.stop();
    for _ in 0..100 { if broker.workers.load(Ordering::Acquire) == 0 { break; } std::thread::sleep(Duration::from_millis(10)); }
    assert_eq!(broker.workers.load(Ordering::Acquire), 0);
    assert!(TcpStream::connect(broker.address()).is_err());
}
#[test]
fn browser_http_and_wrong_pairing_never_open_ui_session() {
    let (tx, rx) = mpsc::channel();
    let broker = test_broker(move |e| tx.send(e).is_ok());
    for frame in ["GET / HTTP/1.1\r\n", "{\"version\":1,\"token\":\"bad\"}\n"] {
        let mut socket = TcpStream::connect(broker.address()).unwrap();
        socket.write_all(frame.as_bytes()).unwrap(); let _ = socket.shutdown(Shutdown::Write);
        assert!(rx.recv_timeout(Duration::from_millis(150)).is_err(), "unauthenticated traffic must not reach the WebView");
    }
    broker.stop();
}

fn paired(broker: &Broker) -> (TcpStream, BufReader<TcpStream>) {
    let mut socket = TcpStream::connect(broker.address()).unwrap();
    socket.set_read_timeout(Some(Duration::from_millis(100))).unwrap();
    let mut reader = BufReader::new(socket.try_clone().unwrap());
    writeln!(socket, "{}", serde_json::json!({"version":1,"token":broker.config(String::new(), "/tmp/mcp-runtime-v1.json".into()).token})).unwrap();
    assert_eq!(wire::read_line(&mut reader, 100, &AtomicBool::new(false), Duration::from_secs(2)).unwrap().as_deref(), Some("{\"ready\":1}"));
    (socket, reader)
}
fn wait_stopped(broker: &Broker) {
    for _ in 0..150 {
        if broker.workers.load(Ordering::Acquire) == 0 { return; }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("MCP worker was not released");
}
#[test]
fn notification_ack_releases_native_slot_without_writing_stdout() {
    let (tx, rx) = mpsc::channel();
    let broker = test_broker(move |e| tx.send(e).is_ok());
    let (mut socket, mut reader) = paired(&broker); rx.recv_timeout(Duration::from_secs(1)).unwrap();
    for _ in 0..16 {
        socket.write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n").unwrap();
        let event = rx.recv_timeout(Duration::from_secs(1)).unwrap(); assert_eq!(event.kind, "message");
        broker.finish(&event.connection_id, event.sequence, None).unwrap();
    }
    assert!(wire::read_line(&mut reader, 100, &AtomicBool::new(false), Duration::from_millis(120)).is_err());
    broker.stop(); wait_stopped(&broker);
}
#[test]
fn reply_must_match_pending_id_and_cannot_be_a_server_command() {
    let (tx, rx) = mpsc::channel();
    let broker = test_broker(move |e| tx.send(e).is_ok());
    let (mut socket, _) = paired(&broker); rx.recv_timeout(Duration::from_secs(1)).unwrap();
    for response in [
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}".to_string(),
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"evil\",\"result\":{}}".to_string(),
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{},\"error\":{}}".to_string(),
        "a".repeat(wire::RESPONSE_BYTES + 1),
    ] {
        socket.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n").unwrap();
        let event = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(broker.finish(&event.connection_id, event.sequence, Some(response)).is_err());
    }
    broker.stop(); wait_stopped(&broker);
}
#[test]
fn native_pending_frames_have_backpressure_and_close_the_offending_peer() {
    let (tx, rx) = mpsc::channel();
    let broker = test_broker(move |e| tx.send(e).is_ok());
    let (mut socket, _) = paired(&broker); rx.recv_timeout(Duration::from_secs(1)).unwrap();
    for _ in 0..wire::MAX_PENDING + 1 { socket.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n").unwrap(); }
    let mut messages = 0;
    loop {
        let event = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        if event.kind == "closed" { break; }
        assert_eq!(event.kind, "message"); messages += 1;
    }
    assert_eq!(messages, wire::MAX_PENDING); broker.stop(); wait_stopped(&broker);
}
#[test]
fn stop_interrupts_authenticated_partial_frames_and_unauthenticated_peers() {
    let broker = test_broker(|_| true);
    let (mut partial, _) = paired(&broker);
    partial.write_all(b"{\"jsonrpc\":").unwrap();
    let _unauthenticated = TcpStream::connect(broker.address()).unwrap();
    broker.stop(); wait_stopped(&broker);
}
#[test]
fn repeated_start_stop_releases_accept_threads_without_requiring_token_rotation() {
    let mut previous_id = String::new();
    for _ in 0..10 {
        let broker = test_broker(|_| true);
        let config = broker.config(String::new(), "/tmp/mcp-runtime-v1.json".into());
        assert_eq!(config.token, "a".repeat(64)); assert_eq!(config.token.len(), 64);
        assert_ne!(config.server_id, previous_id);
        previous_id = config.server_id; broker.stop(); wait_stopped(&broker);
    }
}
#[test]
fn explicit_persistent_pairing_token_survives_broker_restarts() {
    let token = "c".repeat(64);
    let first = Broker::start_with_token(Arc::new(|_| true), token.clone()).unwrap();
    let first_config = first.config(String::new(), "/tmp/mcp-runtime-v1.json".into());
    assert_eq!(first_config.token, token); let first_id = first_config.server_id;
    first.stop(); wait_stopped(&first);
    let second = Broker::start_with_token(Arc::new(|_| true), token.clone()).unwrap();
    let second_config = second.config(String::new(), "/tmp/mcp-runtime-v1.json".into());
    assert_eq!(second_config.token, token); assert_ne!(second_config.server_id, first_id);
    second.stop(); wait_stopped(&second);
}
#[test]
fn connection_cap_includes_peers_that_have_not_authenticated() {
    let broker = test_broker(|_| true);
    let sockets: Vec<_> = (0..wire::MAX_CONNECTIONS).map(|_| TcpStream::connect(broker.address()).unwrap()).collect();
    for _ in 0..100 {
        if broker.workers.load(Ordering::Acquire) == wire::MAX_CONNECTIONS + 1 { break; }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(broker.workers.load(Ordering::Acquire), wire::MAX_CONNECTIONS + 1);
    let excess = TcpStream::connect(broker.address()).unwrap();
    excess.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
    let mut reader = BufReader::new(excess);
    let frame = wire::read_line(&mut reader, 256, &AtomicBool::new(false), Duration::from_secs(1)).unwrap().unwrap();
    assert_eq!(serde_json::from_str::<serde_json::Value>(&frame).unwrap(),
        serde_json::json!({"error":"session_limit","limit":wire::MAX_CONNECTIONS}));
    broker.stop(); drop(sockets); wait_stopped(&broker);
}
#[test]
fn oversized_pairing_and_stale_token_do_not_disable_other_clients() {
    let old = Broker::start_with_token(Arc::new(|_| true), "b".repeat(64)).unwrap();
    let old_token = old.config(String::new(), "/tmp/mcp-runtime-v1.json".into()).token; old.stop(); wait_stopped(&old);
    let (tx, rx) = mpsc::channel();
    let broker = test_broker(move |e| tx.send(e).is_ok());
    for frame in ["x".repeat(1025), serde_json::json!({"version":1,"token":old_token}).to_string()] {
        let mut socket = TcpStream::connect(broker.address()).unwrap(); writeln!(socket, "{frame}").unwrap();
    }
    let _good = paired(&broker);
    assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap().kind, "opened");
    broker.stop(); wait_stopped(&broker);
}

#[test]
fn rpc_ids_match_javascript_integer_and_utf16_normalization() {
    let (tx, rx) = mpsc::channel();
    let broker = test_broker(move |e| tx.send(e).is_ok());
    let (mut socket, mut reader) = paired(&broker);
    rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let cases = [
        ("-0".to_owned(), serde_json::json!(0)),
        ("1.0".into(), serde_json::json!(1)),
        ("2e0".into(), serde_json::json!(2)),
        ("9007199254740991".into(), serde_json::json!(9_007_199_254_740_991i64)),
        ("1.5".into(), serde_json::Value::Null),
        ("9007199254740992".into(), serde_json::Value::Null),
        (serde_json::to_string(&"😀".repeat(64)).unwrap(), serde_json::json!("😀".repeat(64))),
        (serde_json::to_string(&"😀".repeat(65)).unwrap(), serde_json::Value::Null),
    ];
    for (literal, canonical) in cases {
        writeln!(socket, "{{\"jsonrpc\":\"2.0\",\"id\":{literal},\"method\":\"ping\"}}").unwrap();
        let event = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let reply = serde_json::json!({"jsonrpc":"2.0", "id":canonical, "result":{}}).to_string();
        let sent = broker.finish(&event.connection_id, event.sequence, Some(reply.clone()));
        if sent.is_err() { broker.stop(); wait_stopped(&broker); }
        assert!(sent.is_ok(), "Rust must correlate the ID that JSON.parse/JSON.stringify produces: {literal}");
        assert_eq!(wire::read_line(&mut reader, 1024, &AtomicBool::new(false), Duration::from_secs(2)).unwrap().unwrap(), reply);
    }
    broker.stop(); wait_stopped(&broker);
}

use super::wire::{self, MAX_CONNECTIONS, MAX_PENDING, REQUEST_BYTES, RESPONSE_BYTES};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use std::io::{self, BufReader, Write};
use std::net::{Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering}};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeEvent {
    pub server_id: String,
    pub connection_id: String,
    pub kind: &'static str,
    pub sequence: u64,
    pub message: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub server_id: String,
    pub port: u16,
    pub token: String,
    pub executable: String,
    pub runtime_file: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Pairing { version: u8, token: String }

struct Peer {
    authenticated: AtomicBool,
    notification_pending: AtomicBool,
    shutdown: TcpStream,
    writer: Mutex<TcpStream>,
    pending: Mutex<BTreeMap<u64, Value>>,
}
impl Peer { fn close(&self) { let _ = self.shutdown.shutdown(Shutdown::Both); } }

/// One pending fixed notification per authenticated peer. No caller-provided
/// method, text, ID, or payload can enter this server-to-client channel.
pub struct ToolsChangedNotification { peer: Arc<Peer> }
impl ToolsChangedNotification {
    pub fn send(self) -> io::Result<()> {
        let result = self.peer.writer.lock().unwrap()
            .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/tools/list_changed\"}\n");
        if result.is_err() { self.peer.close(); }
        result
    }
}
impl Drop for ToolsChangedNotification {
    fn drop(&mut self) { self.peer.notification_pending.store(false, Ordering::Release); }
}

pub struct Broker {
    pub id: String,
    token: String,
    port: u16,
    stopped: AtomicBool,
    pub workers: AtomicUsize,
    peers: Mutex<HashMap<String, Arc<Peer>>>,
    callback: Arc<dyn Fn(BridgeEvent) -> bool + Send + Sync>,
    next: AtomicU64,
}

fn random_hex<const N: usize>() -> io::Result<String> {
    let mut data = [0u8; N];
    getrandom::fill(&mut data).map_err(|_| io::ErrorKind::Other)?;
    Ok(data.iter().map(|b| format!("{b:02x}")).collect())
}
fn reply_id(text: &str) -> Value {
    // The trusted WebView parses IDs as JavaScript Number/UTF-16 strings. Match
    // its canonical reply before dispatch: -0, 1.0 and 1e0 are legal integers,
    // not null IDs. A mismatch after a committed write must not lose the reply.
    match serde_json::from_str::<Value>(text).ok().and_then(|v| v.get("id").cloned()) {
        Some(Value::String(s)) if !s.is_empty() && s.encode_utf16().count() <= 128 => Value::String(s),
        Some(Value::Number(n)) => n.as_f64()
            .filter(|n| n.is_finite() && n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0)
            .map(|n| json!(n as i64)).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}
impl Broker {
    pub fn start_with_token(callback: Arc<dyn Fn(BridgeEvent) -> bool + Send + Sync>, token: String) -> io::Result<Arc<Self>> {
        if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) { return Err(io::ErrorKind::InvalidInput.into()); }
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let broker = Arc::new(Self { id: random_hex::<16>()?, token,
            port: listener.local_addr()?.port(), stopped: AtomicBool::new(false),
            workers: AtomicUsize::new(1), peers: Mutex::new(HashMap::new()), callback, next: AtomicU64::new(1) });
        let owner = broker.clone();
        thread::Builder::new().name("tf-mcp-accept".into()).spawn(move || {
            let mut workers = Vec::<thread::JoinHandle<()>>::new();
            while !owner.stopped.load(Ordering::Acquire) {
                let mut index = 0;
                while index < workers.len() {
                    if workers[index].is_finished() { let _ = workers.swap_remove(index).join(); } else { index += 1; }
                }
                match listener.accept() {
                    Ok((mut socket, address)) => {
                        if !address.ip().is_loopback() { continue; }
                        let mut peers = owner.peers.lock().unwrap();
                        if peers.len() >= MAX_CONNECTIONS {
                            drop(peers);
                            let _ = socket.set_write_timeout(Some(Duration::from_secs(1)));
                            let _ = writeln!(socket, "{}", json!({"error":"session_limit","limit":MAX_CONNECTIONS}));
                            let _ = socket.shutdown(Shutdown::Both);
                            continue;
                        }
                        // The nonblocking listener can yield a nonblocking peer on macOS.
                        if socket.set_nonblocking(false).is_err()
                            || socket.set_read_timeout(Some(Duration::from_millis(250))).is_err() { continue; }
                        let Ok(writer) = socket.try_clone() else { continue; };
                        let Ok(shutdown) = socket.try_clone() else { continue; };
                        let _ = writer.set_write_timeout(Some(Duration::from_secs(1)));
                        let id = owner.next.fetch_add(1, Ordering::Relaxed).to_string();
                        let peer = Arc::new(Peer { authenticated: AtomicBool::new(false), notification_pending: AtomicBool::new(false),
                            shutdown, writer: Mutex::new(writer), pending: Mutex::new(BTreeMap::new()) });
                        peers.insert(id.clone(), peer.clone()); drop(peers);
                        let run = owner.clone();
                        let worker_id = id.clone();
                        owner.workers.fetch_add(1, Ordering::Relaxed);
                        match thread::Builder::new().name("tf-mcp-peer".into()).spawn(move || {
                            let _ = run.serve(&worker_id, socket, &peer);
                            peer.close(); run.peers.lock().unwrap().remove(&worker_id);
                            if peer.authenticated.load(Ordering::Acquire) { run.emit(&worker_id, "closed", 0, None); }
                            run.workers.fetch_sub(1, Ordering::Release);
                        }) {
                            Ok(handle) => workers.push(handle),
                            Err(_) => { owner.peers.lock().unwrap().remove(&id); owner.workers.fetch_sub(1, Ordering::Relaxed); }
                        }
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(25)),
                    Err(_) => break,
                }
            }
            drop(listener);
            owner.stop();
            for handle in workers { let _ = handle.join(); }
            owner.workers.fetch_sub(1, Ordering::Release);
        })?;
        Ok(broker)
    }
    pub fn config(&self, executable: String, runtime_file: String) -> ConnectionConfig {
        ConnectionConfig { server_id: self.id.clone(), port: self.port, token: self.token.clone(), executable, runtime_file }
    }
    pub fn port(&self) -> u16 { self.port }
    fn emit(&self, id: &str, kind: &'static str, sequence: u64, message: Option<String>) -> bool {
        (self.callback)(BridgeEvent { server_id: self.id.clone(), connection_id: id.into(), kind, sequence, message })
    }
    fn serve(&self, id: &str, socket: TcpStream, peer: &Peer) -> io::Result<()> {
        let mut reader = BufReader::new(socket);
        let line = wire::read_line(&mut reader, 1024, &self.stopped, Duration::from_secs(3))?
            .ok_or(io::ErrorKind::UnexpectedEof)?;
        let pairing: Pairing = serde_json::from_str(&line).map_err(|_| io::ErrorKind::PermissionDenied)?;
        if pairing.version != 1 || !wire::token_matches(&self.token, &pairing.token) {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        peer.writer.lock().unwrap().write_all(b"{\"ready\":1}\n")?;
        peer.authenticated.store(true, Ordering::Release);
        if !self.emit(id, "opened", 0, None) { return Err(io::ErrorKind::BrokenPipe.into()); }
        let mut sequence = 0;
        let mut window = Instant::now();
        let mut messages = 0;
        while let Some(line) = wire::read_line(&mut reader, REQUEST_BYTES, &self.stopped, Duration::MAX)? {
            if window.elapsed() >= Duration::from_secs(1) { window = Instant::now(); messages = 0; }
            messages += 1;
            if messages > 60 { return Err(io::ErrorKind::InvalidData.into()); }
            sequence += 1;
            let mut pending = peer.pending.lock().unwrap();
            if pending.len() >= MAX_PENDING { return Err(io::ErrorKind::OutOfMemory.into()); }
            pending.insert(sequence, reply_id(&line)); drop(pending);
            if !self.emit(id, "message", sequence, Some(line)) { return Err(io::ErrorKind::BrokenPipe.into()); }
        }
        Ok(())
    }
    /// Only the trusted main WebView replies through this method. Pending frame
    /// IDs prevent replayed UI callbacks from writing on a different invocation.
    pub fn finish(&self, id: &str, sequence: u64, response: Option<String>) -> io::Result<()> {
        if self.stopped.load(Ordering::Acquire) { return Err(io::ErrorKind::ConnectionAborted.into()); }
        let peer = self.peers.lock().unwrap().get(id).cloned().ok_or(io::ErrorKind::NotConnected)?;
        let expected = peer.pending.lock().unwrap().remove(&sequence).ok_or(io::ErrorKind::InvalidInput)?;
        if let Some(text) = response {
            if text.len() > RESPONSE_BYTES || text.contains(['\n', '\r']) { return Err(io::ErrorKind::InvalidData.into()); }
            let value: Value = serde_json::from_str(&text).map_err(|_| io::ErrorKind::InvalidData)?;
            if value.get("jsonrpc") != Some(&json!("2.0")) || value.get("id") != Some(&expected)
                || value.get("method").is_some() || (value.get("result").is_some() == value.get("error").is_some()) {
                return Err(io::ErrorKind::InvalidData.into());
            }
            let mut writer = peer.writer.lock().unwrap();
            writer.write_all(text.as_bytes())?; writer.write_all(b"\n")?;
        }
        Ok(())
    }
    /// Reserve before spawning blocking I/O, so a slow client cannot grow a task queue.
    pub fn reserve_tools_changed(&self, id: &str) -> io::Result<Option<ToolsChangedNotification>> {
        if self.stopped.load(Ordering::Acquire) { return Err(io::ErrorKind::ConnectionAborted.into()); }
        let peer = self.peers.lock().unwrap().get(id).cloned().ok_or(io::ErrorKind::NotConnected)?;
        if !peer.authenticated.load(Ordering::Acquire) { return Err(io::ErrorKind::PermissionDenied.into()); }
        if peer.notification_pending.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() { return Ok(None); }
        Ok(Some(ToolsChangedNotification { peer }))
    }
    pub fn disconnect(&self, id: &str) {
        if let Some(peer) = self.peers.lock().unwrap().get(id) { peer.close(); }
    }
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        for peer in self.peers.lock().unwrap().values() { peer.close(); }
    }
    #[cfg(test)]
    pub fn address(&self) -> std::net::SocketAddr { std::net::SocketAddr::from((Ipv4Addr::LOCALHOST, self.port)) }
}

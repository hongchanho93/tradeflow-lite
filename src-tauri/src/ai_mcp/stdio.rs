use super::wire::{self, REQUEST_BYTES, RESPONSE_BYTES};
use serde::Deserialize;
use std::fs;
use std::io::{self, BufReader, Write};
use std::net::{Ipv4Addr, Shutdown, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeEndpoint { version: u8, server_id: String, port: u16 }

fn read_endpoint(path: &Path) -> io::Result<RuntimeEndpoint> {
    if !path.is_absolute() || path.file_name().and_then(|name| name.to_str()) != Some(super::persistence::RUNTIME_FILE) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    if fs::symlink_metadata(path)?.file_type().is_symlink() { return Err(io::ErrorKind::PermissionDenied.into()); }
    if fs::metadata(path)?.len() > 8 * 1024 { return Err(io::ErrorKind::InvalidData.into()); }
    let endpoint: RuntimeEndpoint = serde_json::from_slice(&fs::read(path)?).map_err(|_| io::ErrorKind::InvalidData)?;
    if endpoint.version != 1 || endpoint.port == 0 || endpoint.server_id.len() != 32
        || !endpoint.server_id.bytes().all(|byte| byte.is_ascii_hexdigit()) { return Err(io::ErrorKind::InvalidData.into()); }
    Ok(endpoint)
}

fn connect_runtime() -> io::Result<TcpStream> {
    if let Ok(runtime) = std::env::var("TRADEFLOW_MCP_RUNTIME_FILE") {
        if runtime.len() > 4096 || runtime.contains(['\0', '\n', '\r']) { return Err(io::ErrorKind::InvalidInput.into()); }
        let path = PathBuf::from(runtime);
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Ok(endpoint) = read_endpoint(&path) {
                if let Ok(socket) = TcpStream::connect_timeout(&(Ipv4Addr::LOCALHOST, endpoint.port).into(), Duration::from_millis(400)) { return Ok(socket); }
            }
            if Instant::now() >= deadline { return Err(io::ErrorKind::NotConnected.into()); }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    let port: u16 = std::env::var("TRADEFLOW_MCP_PORT").ok().and_then(|s| s.parse().ok())
        .filter(|p| *p > 0).ok_or(io::ErrorKind::InvalidInput)?;
    TcpStream::connect_timeout(&(Ipv4Addr::LOCALHOST, port).into(), Duration::from_secs(3))
}

/// Fixed-purpose relay. No files, subprocess execution, account login, HTTP
/// URLs or model credentials. Environment contains only this run's pairing.
pub fn run() -> io::Result<()> {
    let token = std::env::var("TRADEFLOW_MCP_TOKEN").map_err(|_| io::ErrorKind::InvalidInput)?;
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) { return Err(io::ErrorKind::InvalidInput.into()); }
    let mut socket = connect_runtime()?;
    socket.set_read_timeout(Some(Duration::from_secs(1)))?;
    socket.set_write_timeout(Some(Duration::from_secs(3)))?;
    writeln!(socket, "{}", serde_json::json!({ "version": 1, "token": token }))?;
    let mut reader = BufReader::new(socket.try_clone()?);
    let stop = AtomicBool::new(false);
    let handshake = wire::read_line(&mut reader, 1024, &stop, Duration::from_secs(3))?;
    if handshake.as_deref() != Some("{\"ready\":1}") {
        if let Some(frame) = handshake.as_deref()
            && let Ok(value) = serde_json::from_str::<serde_json::Value>(frame)
            && value.get("error").and_then(|item| item.as_str()) == Some("session_limit") {
            let limit = value.get("limit").and_then(|item| item.as_u64()).unwrap_or(0);
            return Err(io::Error::new(io::ErrorKind::ConnectionRefused, format!("mcp_session_limit:{limit}")));
        }
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    std::thread::Builder::new().name("tf-mcp-stdin".into()).spawn(move || {
        let stop = AtomicBool::new(false);
        let stdin = io::stdin(); let mut input = stdin.lock();
        while let Ok(Some(line)) = wire::read_line(&mut input, REQUEST_BYTES, &stop, Duration::MAX) {
            if socket.write_all(line.as_bytes()).and_then(|_| socket.write_all(b"\n")).is_err() { break; }
        }
        let _ = socket.shutdown(Shutdown::Both);
    })?;
    let stdout = io::stdout(); let mut output = stdout.lock();
    while let Some(line) = wire::read_line(&mut reader, RESPONSE_BYTES, &stop, Duration::MAX)? {
        // stdout is exclusively newline-delimited MCP replies.
        output.write_all(line.as_bytes())?; output.write_all(b"\n")?; output.flush()?;
    }
    Ok(())
}

use std::io::{self, BufRead};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

// Process guard, not a product quota. Large result documents may be written
// through the shared result-file tool without fragmenting the MCP call.
pub const REQUEST_BYTES: usize = 16 * 1024 * 1024;
pub const RESPONSE_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_CONNECTIONS: usize = 8;
pub const MAX_PENDING: usize = 8;

/// Bounded newline framing. Socket timeouts let cancellation and an absolute
/// partial-frame deadline progress even when a peer sends one byte at a time.
pub fn read_line<R: BufRead>(reader: &mut R, limit: usize, stop: &AtomicBool, idle: Duration) -> io::Result<Option<String>> {
    let started = Instant::now();
    let mut first_byte = None;
    let mut output = Vec::new();
    loop {
        if stop.load(Ordering::Acquire) { return Err(io::ErrorKind::ConnectionAborted.into()); }
        if started.elapsed() > idle || first_byte.is_some_and(|t: Instant| t.elapsed() > Duration::from_secs(3)) {
            return Err(io::ErrorKind::TimedOut.into());
        }
        let available = match reader.fill_buf() {
            Ok(value) => value,
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            Err(e) if matches!(e.kind(), io::ErrorKind::TimedOut | io::ErrorKind::Interrupted) => continue,
            Err(e) => return Err(e),
        };
        if available.is_empty() {
            return if output.is_empty() { Ok(None) } else { Err(io::ErrorKind::UnexpectedEof.into()) };
        }
        first_byte.get_or_insert_with(Instant::now);
        let end = available.iter().position(|&b| b == b'\n');
        let take = end.unwrap_or(available.len());
        let total = output.len() + take;
        // CR is framing, not payload, even when CR and LF arrive separately.
        let last = available.get(take.wrapping_sub(1)).or_else(|| output.last());
        if total > limit && !(total == limit + 1 && last == Some(&b'\r')) {
            return Err(io::ErrorKind::InvalidData.into());
        }
        output.extend_from_slice(&available[..take]);
        reader.consume(take + usize::from(end.is_some()));
        if end.is_some() {
            if output.last() == Some(&b'\r') { output.pop(); }
            return String::from_utf8(output).map(Some).map_err(|_| io::ErrorKind::InvalidData.into());
        }
    }
}

pub fn token_matches(expected: &str, given: &str) -> bool {
    if given.len() != 64 || expected.len() != 64 { return false; }
    expected.bytes().zip(given.bytes()).fold(0u8, |diff, (a, b)| diff | (a ^ b)) == 0
}

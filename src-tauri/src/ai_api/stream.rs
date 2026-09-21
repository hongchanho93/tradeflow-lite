use super::profile::ApiResult;

// Process-safety ceilings, deliberately far above ordinary model traffic.
// These are not user workflow quotas.
pub const MAX_RESPONSE: usize = 64 * 1024 * 1024;
pub const MAX_EVENT: usize = 16 * 1024 * 1024;

/// Byte-first SSE framing preserves split UTF-8, CRLF and multiline data.
/// A half event at EOF is not a complete message and must never run a tool.
#[derive(Default)]
pub struct SseDecoder { line: Vec<u8>, data: String, total: usize, cr: bool, first: bool }
impl SseDecoder {
    pub fn feed(&mut self, input: &[u8]) -> ApiResult<Vec<String>> {
        self.total += input.len();
        if self.total > MAX_RESPONSE { return Err("response_too_large"); }
        let mut events = Vec::new();
        for &b in input {
            if self.cr && b == b'\n' { self.cr = false; continue; }
            self.cr = b == b'\r';
            if b == b'\r' || b == b'\n' {
                let mut line = std::str::from_utf8(&self.line).map_err(|_| "invalid_utf8")?;
                if !self.first { line = line.trim_start_matches('\u{feff}'); self.first = true; }
                if line.is_empty() {
                    if !self.data.is_empty() { self.data.pop(); events.push(std::mem::take(&mut self.data)); }
                } else if let Some(data) = line.strip_prefix("data:") {
                    self.data.push_str(data.strip_prefix(' ').unwrap_or(data)); self.data.push('\n');
                    if self.data.len() > MAX_EVENT { return Err("event_too_large"); }
                }
                self.line.clear();
            } else {
                if self.line.len() >= MAX_EVENT { return Err("event_too_large"); }
                self.line.push(b);
            }
        }
        Ok(events)
    }
    pub fn finish(&self) -> ApiResult<()> {
        if self.line.is_empty() && self.data.is_empty() { Ok(()) } else { Err("stream_incomplete") }
    }
}

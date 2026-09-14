//! 标准行情主站：沪深京股票、ETF、指数（默认端口 7709）。
//!
//! 每个文件对应一类命令。新增命令时新建文件、实现 [`Request`](super::Request)
//! 并在这里导出即可。

mod bars;
mod handshake;
mod quotes;
mod xdxr;

pub use bars::{BarPeriod, IndexBar, IndexBars, MAX_BARS_PER_REQUEST, RawBar, SecurityBars};
pub use handshake::SetupStage;
pub use quotes::{BookLevel, SecurityQuote, SecurityQuotes};
pub use xdxr::{XdxrDetail, XdxrEntry, XdxrInfo};

use super::client::Session;
use super::error::TdxError;
use super::request::Dialect;

/// 标准行情方言。
pub struct Standard;

impl Dialect for Standard {
    const MARKER: u8 = 0x0c;

    fn handshake<S: Session<Self>>(session: &mut S) -> Result<(), TdxError> {
        session.call(&SetupStage::FIRST)?;
        session.call(&SetupStage::SECOND)?;
        Ok(())
    }
}

/// 标准行情里的市场编号。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Market {
    Shenzhen,
    Shanghai,
    Beijing,
}

impl Market {
    pub fn code(self) -> u8 {
        match self {
            Self::Shenzhen => 0,
            Self::Shanghai => 1,
            Self::Beijing => 2,
        }
    }

    pub fn from_code(code: u8) -> Option<Self> {
        match code {
            0 => Some(Self::Shenzhen),
            1 => Some(Self::Shanghai),
            2 => Some(Self::Beijing),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Standard;
    use crate::tdx::request::{Dialect, Request};
    use crate::tdx::wire::ByteReader;
    use crate::tdx::{Session, TdxError};

    #[derive(Default)]
    struct HandshakeRecorder {
        commands: Vec<u16>,
    }

    impl Session<Standard> for HandshakeRecorder {
        fn call<R: Request<Dialect = Standard>>(
            &mut self,
            request: &R,
        ) -> Result<R::Response, TdxError> {
            self.commands.push(R::COMMAND);
            request.decode(&mut ByteReader::new(&[]))
        }
    }

    #[test]
    fn standard_handshake_uses_only_the_two_current_setup_stages() {
        let mut session = HandshakeRecorder::default();
        Standard::handshake(&mut session).unwrap();
        assert_eq!(session.commands, [0x000d, 0x000d]);
    }
}

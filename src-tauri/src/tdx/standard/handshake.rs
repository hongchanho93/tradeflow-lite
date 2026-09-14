use super::Standard;
use crate::tdx::error::TdxError;
use crate::tdx::request::Request;
use crate::tdx::wire::{ByteReader, ByteWriter};

/// 握手的会话阶段命令，依次发送第 1、2 阶段。
pub struct SetupStage(u8);

impl SetupStage {
    pub const FIRST: Self = Self(1);
    pub const SECOND: Self = Self(2);
}

impl Request for SetupStage {
    type Dialect = Standard;
    type Response = ();
    const COMMAND: u16 = 0x000d;

    fn encode(&self, body: &mut ByteWriter) -> Result<(), TdxError> {
        body.u8(self.0);
        Ok(())
    }

    fn decode(&self, _body: &mut ByteReader<'_>) -> Result<(), TdxError> {
        Ok(())
    }
}

use super::client::Session;
use super::error::TdxError;
use super::wire::{ByteReader, ByteWriter};

/// 一种主站协议方言。同一方言的命令共用包头标记和握手流程。
pub trait Dialect: Sized + 'static {
    /// 请求包头的第一个字节。
    const MARKER: u8;

    /// 连接建立后、发送业务命令前必须完成的握手。
    fn handshake<S: Session<Self>>(session: &mut S) -> Result<(), TdxError>;
}

/// 一个协议命令。实现者只描述“请求体怎么写、响应体怎么读”，
/// 分帧、序号、压缩和网络读写由 [`super::Client`] 统一处理。
pub trait Request: 'static {
    type Dialect: Dialect;
    type Response: 'static;

    const COMMAND: u16;

    /// 写入命令号之后的请求体。
    fn encode(&self, body: &mut ByteWriter) -> Result<(), TdxError>;

    /// 解析已解压的响应体。
    fn decode(&self, body: &mut ByteReader<'_>) -> Result<Self::Response, TdxError>;
}

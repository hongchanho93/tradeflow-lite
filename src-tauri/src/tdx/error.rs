use std::fmt;
use std::io;

#[derive(Debug)]
pub enum TdxError {
    /// 网络连接、读写或超时。
    Io(io::Error),
    /// 响应包头不合法，或与刚发出的请求对不上。
    Frame(String),
    /// 响应体长度或内容与命令格式不符。
    Decode(String),
    /// 调用参数不符合协议限制。
    InvalidArgument(String),
    /// 连接此前已经出错，数据流位置不可信，必须重新连接。
    Broken,
}

impl fmt::Display for TdxError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "io: {error}"),
            Self::Frame(message) => write!(formatter, "frame: {message}"),
            Self::Decode(message) => write!(formatter, "decode: {message}"),
            Self::InvalidArgument(message) => write!(formatter, "invalid argument: {message}"),
            Self::Broken => write!(formatter, "connection is broken by an earlier error"),
        }
    }
}

impl std::error::Error for TdxError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for TdxError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

use std::io::{Read, Write};
use std::marker::PhantomData;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

use super::error::TdxError;
use super::frame::{self, RESPONSE_HEADER_LEN};
use super::request::{Dialect, Request};
use super::wire::{ByteReader, ByteWriter};

/// 能执行协议命令的会话。业务代码依赖这个 trait 而不是具体连接，
/// 测试时可以换成不走网络的实现。
pub trait Session<D: Dialect> {
    fn call<R: Request<Dialect = D>>(&mut self, request: &R) -> Result<R::Response, TdxError>;
}

/// 到一台主站的同步 TCP 连接。
///
/// 任何网络或分帧错误之后，数据流位置不再可信，连接会被标记为损坏，
/// 后续调用直接返回 [`TdxError::Broken`]；调用方应丢弃并重新连接。
pub struct Client<D: Dialect> {
    stream: TcpStream,
    next_sequence: u32,
    broken: bool,
    dialect: PhantomData<D>,
}

impl<D: Dialect> Client<D> {
    /// 连接并完成该方言的标准握手。`timeout` 同时用于建立连接和每次读写。
    pub fn connect(host: &str, timeout: Duration) -> Result<Self, TdxError> {
        let mut client = Self::connect_raw(host, timeout)?;
        D::handshake(&mut client)?;
        Ok(client)
    }

    /// 只建立 TCP 连接，不握手。用于需要自定义握手流程的主站。
    pub fn connect_raw(host: &str, timeout: Duration) -> Result<Self, TdxError> {
        let address = resolve(host)?;
        let stream = TcpStream::connect_timeout(&address, timeout)?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;
        stream.set_nodelay(true)?;
        Ok(Self {
            stream,
            next_sequence: 1,
            broken: false,
            dialect: PhantomData,
        })
    }

    fn exchange(&mut self, command: u16, body: &[u8]) -> Result<Vec<u8>, TdxError> {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.wrapping_add(1);
        let packet = frame::encode_request(D::MARKER, sequence, command, body)?;
        self.stream.write_all(&packet)?;

        let mut header_bytes = [0u8; RESPONSE_HEADER_LEN];
        self.stream.read_exact(&mut header_bytes)?;
        let header = frame::decode_response_header(&header_bytes)?;
        let mut payload = vec![0u8; header.body_len];
        self.stream.read_exact(&mut payload)?;
        if header.sequence != sequence || header.command != command {
            return Err(TdxError::Frame(format!(
                "response for sequence {} command 0x{:04x} does not match request {sequence} 0x{command:04x}",
                header.sequence, header.command
            )));
        }
        frame::decode_body(&header, payload)
    }
}

impl<D: Dialect> Session<D> for Client<D> {
    fn call<R: Request<Dialect = D>>(&mut self, request: &R) -> Result<R::Response, TdxError> {
        if self.broken {
            return Err(TdxError::Broken);
        }
        let mut body = ByteWriter::new();
        request.encode(&mut body)?;
        let response = self
            .exchange(R::COMMAND, body.as_slice())
            .inspect_err(|_| {
                self.broken = true;
            })?;
        request.decode(&mut ByteReader::new(&response))
    }
}

fn resolve(host: &str) -> Result<SocketAddr, TdxError> {
    host.to_socket_addrs()
        .map_err(|error| TdxError::InvalidArgument(format!("invalid host {host:?}: {error}")))?
        .next()
        .ok_or_else(|| TdxError::InvalidArgument(format!("host {host:?} has no address")))
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    use super::{Client, Session};
    use crate::tdx::error::TdxError;
    use crate::tdx::request::{Dialect, Request};
    use crate::tdx::wire::{ByteReader, ByteWriter};

    struct Echo;

    impl Dialect for Echo {
        const MARKER: u8 = 0x0c;

        fn handshake<S: Session<Self>>(_session: &mut S) -> Result<(), TdxError> {
            Ok(())
        }
    }

    struct Ping(u8);

    impl Request for Ping {
        type Dialect = Echo;
        type Response = u8;
        const COMMAND: u16 = 0x1234;

        fn encode(&self, body: &mut ByteWriter) -> Result<(), TdxError> {
            body.u8(self.0);
            Ok(())
        }

        fn decode(&self, body: &mut ByteReader<'_>) -> Result<u8, TdxError> {
            body.u8()
        }
    }

    fn respond(stream: &mut std::net::TcpStream, sequence: u32, command: u16, body: &[u8]) {
        let mut header = vec![0xb1, 0xcb, 0x74, 0x00, 0x0c];
        header.extend_from_slice(&sequence.to_le_bytes());
        header.push(0);
        header.extend_from_slice(&command.to_le_bytes());
        header.extend_from_slice(&(body.len() as u16).to_le_bytes());
        header.extend_from_slice(&(body.len() as u16).to_le_bytes());
        stream.write_all(&header).unwrap();
        stream.write_all(body).unwrap();
    }

    #[test]
    fn client_frames_requests_and_rejects_mismatched_responses() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 13];
            stream.read_exact(&mut request).unwrap();
            assert_eq!(request[0], 0x0c);
            assert_eq!(&request[10..12], &[0x34, 0x12]);
            let sequence = u32::from_le_bytes(request[1..5].try_into().unwrap());
            respond(&mut stream, sequence, 0x1234, &[request[12] + 1]);

            stream.read_exact(&mut request).unwrap();
            let sequence = u32::from_le_bytes(request[1..5].try_into().unwrap());
            respond(&mut stream, sequence + 7, 0x1234, &[0]);
        });

        let mut client = Client::<Echo>::connect(&address, Duration::from_secs(2)).unwrap();
        assert_eq!(client.call(&Ping(41)).unwrap(), 42);
        assert!(matches!(client.call(&Ping(1)), Err(TdxError::Frame(_))));
        assert!(matches!(client.call(&Ping(1)), Err(TdxError::Broken)));
        server.join().unwrap();
    }
}

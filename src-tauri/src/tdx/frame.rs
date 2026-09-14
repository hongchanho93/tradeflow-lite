//! 数据包分帧，与具体命令无关。
//!
//! 请求包头（12 字节）：
//! `标记 u8 | 序号 u32 | 0x01 u8 | 长度 u16 | 长度 u16 | 命令号 u16`，
//! 两个长度相同，都等于“命令号 + 请求体”的字节数。
//!
//! 响应包头（16 字节）：
//! `0x0074cbb1 u32 | 标记 u8 | 序号 u32 | 保留 u8 | 命令号 u16 | 压缩长度 u16 | 原始长度 u16`，
//! 两个长度不同表示响应体经过 zlib 压缩。

use std::io::Read;

use flate2::read::ZlibDecoder;

use super::error::TdxError;

pub(crate) const RESPONSE_HEADER_LEN: usize = 16;
const RESPONSE_MAGIC: u32 = 0x0074_cbb1;
const REQUEST_FLAG: u8 = 0x01;

pub(crate) fn encode_request(
    marker: u8,
    sequence: u32,
    command: u16,
    body: &[u8],
) -> Result<Vec<u8>, TdxError> {
    let length = u16::try_from(body.len() + 2).map_err(|_| {
        TdxError::InvalidArgument(format!("request body is too large: {} bytes", body.len()))
    })?;
    let mut packet = Vec::with_capacity(12 + body.len());
    packet.push(marker);
    packet.extend_from_slice(&sequence.to_le_bytes());
    packet.push(REQUEST_FLAG);
    packet.extend_from_slice(&length.to_le_bytes());
    packet.extend_from_slice(&length.to_le_bytes());
    packet.extend_from_slice(&command.to_le_bytes());
    packet.extend_from_slice(body);
    Ok(packet)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ResponseHeader {
    pub sequence: u32,
    pub command: u16,
    pub body_len: usize,
    pub raw_len: usize,
}

pub(crate) fn decode_response_header(
    bytes: &[u8; RESPONSE_HEADER_LEN],
) -> Result<ResponseHeader, TdxError> {
    let magic = u32::from_le_bytes(bytes[0..4].try_into().expect("4 bytes"));
    if magic != RESPONSE_MAGIC {
        return Err(TdxError::Frame(format!(
            "unexpected response magic 0x{magic:08x}"
        )));
    }
    Ok(ResponseHeader {
        sequence: u32::from_le_bytes(bytes[5..9].try_into().expect("4 bytes")),
        command: u16::from_le_bytes(bytes[10..12].try_into().expect("2 bytes")),
        body_len: usize::from(u16::from_le_bytes(
            bytes[12..14].try_into().expect("2 bytes"),
        )),
        raw_len: usize::from(u16::from_le_bytes(
            bytes[14..16].try_into().expect("2 bytes"),
        )),
    })
}

pub(crate) fn decode_body(header: &ResponseHeader, body: Vec<u8>) -> Result<Vec<u8>, TdxError> {
    if header.body_len == header.raw_len {
        return Ok(body);
    }
    let mut raw = Vec::with_capacity(header.raw_len);
    ZlibDecoder::new(body.as_slice())
        .read_to_end(&mut raw)
        .map_err(|error| TdxError::Frame(format!("zlib: {error}")))?;
    if raw.len() != header.raw_len {
        return Err(TdxError::Frame(format!(
            "decompressed {} bytes, header declared {}",
            raw.len(),
            header.raw_len
        )));
    }
    Ok(raw)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use flate2::Compression;
    use flate2::write::ZlibEncoder;

    use super::{ResponseHeader, decode_body, decode_response_header, encode_request};

    #[test]
    fn request_header_carries_marker_sequence_length_and_command() {
        let packet = encode_request(0x0c, 0x1122_3344, 0x052d, &[0xaa, 0xbb]).unwrap();
        assert_eq!(
            packet,
            [
                0x0c, 0x44, 0x33, 0x22, 0x11, 0x01, 0x04, 0x00, 0x04, 0x00, 0x2d, 0x05, 0xaa, 0xbb
            ]
        );
    }

    #[test]
    fn response_header_matches_live_host_layout() {
        // 实测 117.34.114.15:7709 对序号 0x11223344 的日线请求返回的包头。
        let bytes = [
            0xb1, 0xcb, 0x74, 0x00, 0x0c, 0x44, 0x33, 0x22, 0x11, 0x00, 0x2d, 0x05, 0x28, 0x00,
            0x28, 0x00,
        ];
        assert_eq!(
            decode_response_header(&bytes).unwrap(),
            ResponseHeader {
                sequence: 0x1122_3344,
                command: 0x052d,
                body_len: 40,
                raw_len: 40
            }
        );
        let mut corrupt = bytes;
        corrupt[0] = 0;
        assert!(decode_response_header(&corrupt).is_err());
    }

    #[test]
    fn compressed_body_is_inflated_and_length_checked() {
        let raw = b"tradeflow lite tdx body".repeat(8);
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&raw).unwrap();
        let compressed = encoder.finish().unwrap();
        let header = ResponseHeader {
            sequence: 1,
            command: 1,
            body_len: compressed.len(),
            raw_len: raw.len(),
        };
        assert_eq!(decode_body(&header, compressed.clone()).unwrap(), raw);
        let wrong = ResponseHeader {
            raw_len: raw.len() + 1,
            ..header
        };
        assert!(decode_body(&wrong, compressed).is_err());
    }
}

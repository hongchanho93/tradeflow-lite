//! 协议字节读写。所有多字节整数均为小端序。

use super::error::TdxError;

#[derive(Default)]
pub struct ByteWriter {
    buffer: Vec<u8>,
}

impl ByteWriter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn u8(&mut self, value: u8) -> &mut Self {
        self.buffer.push(value);
        self
    }

    pub fn u16(&mut self, value: u16) -> &mut Self {
        self.buffer.extend_from_slice(&value.to_le_bytes());
        self
    }

    pub fn u32(&mut self, value: u32) -> &mut Self {
        self.buffer.extend_from_slice(&value.to_le_bytes());
        self
    }

    pub fn bytes(&mut self, value: &[u8]) -> &mut Self {
        self.buffer.extend_from_slice(value);
        self
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.buffer
    }
}

pub struct ByteReader<'a> {
    data: &'a [u8],
    position: usize,
}

impl<'a> ByteReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, position: 0 }
    }

    pub fn remaining(&self) -> usize {
        self.data.len() - self.position
    }

    pub fn take(&mut self, length: usize) -> Result<&'a [u8], TdxError> {
        if self.remaining() < length {
            return Err(TdxError::Decode(format!(
                "need {length} bytes at offset {}, only {} left",
                self.position,
                self.remaining()
            )));
        }
        let slice = &self.data[self.position..self.position + length];
        self.position += length;
        Ok(slice)
    }

    pub fn skip(&mut self, length: usize) -> Result<(), TdxError> {
        self.take(length).map(|_| ())
    }

    pub fn array<const N: usize>(&mut self) -> Result<[u8; N], TdxError> {
        Ok(self
            .take(N)?
            .try_into()
            .expect("slice has requested length"))
    }

    pub fn u8(&mut self) -> Result<u8, TdxError> {
        Ok(self.take(1)?[0])
    }

    pub fn u16(&mut self) -> Result<u16, TdxError> {
        Ok(u16::from_le_bytes(self.array()?))
    }

    pub fn i16(&mut self) -> Result<i16, TdxError> {
        Ok(i16::from_le_bytes(self.array()?))
    }

    pub fn u32(&mut self) -> Result<u32, TdxError> {
        Ok(u32::from_le_bytes(self.array()?))
    }

    /// IEEE-754 单精度浮点。协议里的成交量、成交额和股本数都用这种编码。
    pub fn f32(&mut self) -> Result<f64, TdxError> {
        Ok(f64::from(f32::from_le_bytes(self.array()?)))
    }

    /// 变长有符号整数，协议里的价格及价差都用这种编码。
    ///
    /// 首字节：bit7 = 后面还有字节，bit6 = 负数，低 6 位为数值最低位；
    /// 后续字节：bit7 = 后面还有字节，低 7 位依次拼到更高位。
    pub fn varint(&mut self) -> Result<i64, TdxError> {
        let first = self.u8()?;
        let negative = first & 0x40 != 0;
        let mut value = i64::from(first & 0x3f);
        let mut more = first & 0x80 != 0;
        let mut shift = 6;
        while more {
            if shift > 62 {
                return Err(TdxError::Decode("varint is too long".to_string()));
            }
            let byte = self.u8()?;
            value |= i64::from(byte & 0x7f) << shift;
            more = byte & 0x80 != 0;
            shift += 7;
        }
        Ok(if negative { -value } else { value })
    }
}

/// 测试用的变长整数编码，与 [`ByteReader::varint`] 互逆。
#[cfg(test)]
pub(crate) fn encode_varint(value: i64, out: &mut Vec<u8>) {
    let magnitude = value.unsigned_abs();
    let mut first = (magnitude & 0x3f) as u8;
    if value < 0 {
        first |= 0x40;
    }
    let mut rest = magnitude >> 6;
    if rest > 0 {
        first |= 0x80;
    }
    out.push(first);
    while rest > 0 {
        let mut byte = (rest & 0x7f) as u8;
        rest >>= 7;
        if rest > 0 {
            byte |= 0x80;
        }
        out.push(byte);
    }
}

#[cfg(test)]
mod tests {
    use super::{ByteReader, ByteWriter, encode_varint};

    #[test]
    fn varint_decodes_sign_and_continuation_bytes() {
        let cases: &[(&[u8], i64)] = &[
            (&[0x00], 0),
            (&[0x3f], 63),
            (&[0x7f], -63),
            (&[0x80, 0x01], 64),
            (&[0xc0, 0x01], -64),
            (&[0xbf, 0x7f], 63 + (0x7f << 6)),
            (&[0x81, 0x80, 0x01], 1 + (1 << 13)),
        ];
        for (bytes, expected) in cases {
            let mut reader = ByteReader::new(bytes);
            assert_eq!(reader.varint().unwrap(), *expected, "{bytes:02x?}");
            assert_eq!(reader.remaining(), 0);
        }
    }

    #[test]
    fn test_encoder_round_trips() {
        for value in [
            0,
            1,
            -1,
            63,
            -64,
            8_191,
            -8_192,
            1_234_567_890,
            -987_654_321,
        ] {
            let mut bytes = Vec::new();
            encode_varint(value, &mut bytes);
            assert_eq!(ByteReader::new(&bytes).varint().unwrap(), value);
        }
    }

    #[test]
    fn truncated_input_is_a_decode_error_not_a_panic() {
        assert!(ByteReader::new(&[0x80]).varint().is_err());
        assert!(ByteReader::new(&[0x01, 0x02, 0x03]).u32().is_err());
    }

    #[test]
    fn f32_quantities_round_trip() {
        let bytes = 1_234_567.0_f32.to_le_bytes();
        assert_eq!(ByteReader::new(&bytes).f32().unwrap(), 1_234_567.0);
    }

    #[test]
    fn writer_uses_little_endian() {
        let mut writer = ByteWriter::new();
        writer.u8(1).u16(0x0203).u32(0x0405_0607).bytes(b"ab");
        assert_eq!(writer.as_slice(), &[1, 3, 2, 7, 6, 5, 4, b'a', b'b']);
    }
}

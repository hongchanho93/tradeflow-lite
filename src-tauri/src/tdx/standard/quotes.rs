use super::{Market, Standard};
use crate::tdx::error::TdxError;
use crate::tdx::request::Request;
use crate::tdx::types::SecurityCode;
use crate::tdx::wire::{ByteReader, ByteWriter};

/// 批量实时行情快照。
#[derive(Clone, Debug)]
pub struct SecurityQuotes {
    pub securities: Vec<(Market, SecurityCode)>,
}

/// 一档盘口。价格为协议原始整数单位（见 [`SecurityQuote`]）。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BookLevel {
    pub price: i64,
    pub volume: i64,
}

/// 实时行情快照。
///
/// 所有价格字段都是协议原始整数：股票和指数以“分”为单位（除以 100 得元），
/// ETF 等三位小数品种以“厘”为单位（除以 1000 得元）。字段已换算为绝对值，不再是价差。
/// 名为 `unknown_*` 的字段含义尚未确认，原样保留供以后使用。
#[derive(Clone, Debug, PartialEq)]
pub struct SecurityQuote {
    pub market: u8,
    pub code: SecurityCode,
    pub active1: u16,
    pub price: i64,
    pub previous_close: i64,
    pub open: i64,
    pub high: i64,
    pub low: i64,
    /// 服务器时间的原始编码。
    pub server_time: i64,
    pub unknown_1: i64,
    /// 总成交量（手）。
    pub volume: i64,
    /// 现量（手）。
    pub current_volume: i64,
    /// 成交额（元）。
    pub amount: f64,
    /// 内盘。
    pub sell_volume: i64,
    /// 外盘。
    pub buy_volume: i64,
    pub unknown_2: i64,
    pub unknown_3: i64,
    pub bids: [BookLevel; 5],
    pub asks: [BookLevel; 5],
    pub unknown_4: u16,
    pub unknown_5: i64,
    pub unknown_6: i64,
    pub unknown_7: i64,
    pub unknown_8: i64,
    /// 涨速，单位为 0.01%。
    pub speed: i16,
    pub active2: u16,
}

impl Request for SecurityQuotes {
    type Dialect = Standard;
    type Response = Vec<SecurityQuote>;
    const COMMAND: u16 = 0x053e;

    fn encode(&self, body: &mut ByteWriter) -> Result<(), TdxError> {
        let count = u16::try_from(self.securities.len())
            .ok()
            .filter(|count| *count > 0)
            .ok_or_else(|| {
                TdxError::InvalidArgument(format!(
                    "quote request needs 1..=65535 securities, got {}",
                    self.securities.len()
                ))
            })?;
        body.u16(5).u32(0).u16(0).u16(count);
        for (market, code) in &self.securities {
            body.u8(market.code()).bytes(code.as_bytes());
        }
        Ok(())
    }

    fn decode(&self, body: &mut ByteReader<'_>) -> Result<Vec<SecurityQuote>, TdxError> {
        body.skip(2)?;
        let count = body.u16()?;
        (0..count).map(|_| decode_quote(body)).collect()
    }
}

fn decode_quote(body: &mut ByteReader<'_>) -> Result<SecurityQuote, TdxError> {
    let market = body.u8()?;
    let code = SecurityCode::from_bytes(body.array()?);
    let active1 = body.u16()?;
    let price = body.varint()?;
    let previous_close = price + body.varint()?;
    let open = price + body.varint()?;
    let high = price + body.varint()?;
    let low = price + body.varint()?;
    let server_time = body.varint()?;
    let unknown_1 = body.varint()?;
    let volume = body.varint()?;
    let current_volume = body.varint()?;
    let amount = body.f32()?;
    let sell_volume = body.varint()?;
    let buy_volume = body.varint()?;
    let unknown_2 = body.varint()?;
    let unknown_3 = body.varint()?;
    let mut bids = [BookLevel::default(); 5];
    let mut asks = [BookLevel::default(); 5];
    for level in 0..5 {
        bids[level].price = price + body.varint()?;
        asks[level].price = price + body.varint()?;
        bids[level].volume = body.varint()?;
        asks[level].volume = body.varint()?;
    }
    Ok(SecurityQuote {
        market,
        code,
        active1,
        price,
        previous_close,
        open,
        high,
        low,
        server_time,
        unknown_1,
        volume,
        current_volume,
        amount,
        sell_volume,
        buy_volume,
        unknown_2,
        unknown_3,
        bids,
        asks,
        unknown_4: body.u16()?,
        unknown_5: body.varint()?,
        unknown_6: body.varint()?,
        unknown_7: body.varint()?,
        unknown_8: body.varint()?,
        speed: body.i16()?,
        active2: body.u16()?,
    })
}

#[cfg(test)]
mod tests {
    use super::{Market, SecurityQuotes};
    use crate::tdx::request::Request;
    use crate::tdx::types::SecurityCode;
    use crate::tdx::wire::{ByteReader, ByteWriter, encode_varint};

    #[test]
    fn request_lists_each_security_after_fixed_prefix() {
        let request = SecurityQuotes {
            securities: vec![
                (Market::Shanghai, SecurityCode::new("600000").unwrap()),
                (Market::Shenzhen, SecurityCode::new("159915").unwrap()),
            ],
        };
        let mut body = ByteWriter::new();
        request.encode(&mut body).unwrap();
        let mut expected = vec![5, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1];
        expected.extend_from_slice(b"600000");
        expected.push(0);
        expected.extend_from_slice(b"159915");
        assert_eq!(body.as_slice(), expected.as_slice());
        assert!(
            SecurityQuotes { securities: vec![] }
                .encode(&mut ByteWriter::new())
                .is_err()
        );
    }

    #[test]
    fn quote_prices_are_absolute_and_book_levels_are_ordered() {
        let mut bytes = vec![0xb1, 0xcb, 1, 0, 1];
        bytes.extend_from_slice(b"510050");
        bytes.extend_from_slice(&[7, 0]);
        let varints = |bytes: &mut Vec<u8>, values: &[i64]| {
            for value in values {
                encode_varint(*value, bytes);
            }
        };
        // 现价 3037，昨收/开/高/低 为相对价差，然后是时间、保留、总量、现量。
        varints(&mut bytes, &[3037, 6, 11, 30, -3, 14_593_620, -1, 2_000, 5]);
        bytes.extend_from_slice(&123_456.0f32.to_le_bytes());
        varints(&mut bytes, &[900, 1_100, 0, 0]);
        for level in 0..5i64 {
            varints(&mut bytes, &[-1 - level, 1 + level, 10 + level, 20 + level]);
        }
        bytes.extend_from_slice(&[0, 0]);
        varints(&mut bytes, &[0, 0, 0, 0]);
        bytes.extend_from_slice(&(-12i16).to_le_bytes());
        bytes.extend_from_slice(&[7, 0]);

        let request = SecurityQuotes { securities: vec![] };
        let quotes = request.decode(&mut ByteReader::new(&bytes)).unwrap();
        let quote = &quotes[0];
        assert_eq!(quote.code.to_string(), "510050");
        assert_eq!(
            (
                quote.price,
                quote.previous_close,
                quote.open,
                quote.high,
                quote.low
            ),
            (3037, 3043, 3048, 3067, 3034)
        );
        assert_eq!((quote.volume, quote.amount), (2_000, 123_456.0));
        assert_eq!((quote.bids[0].price, quote.asks[0].price), (3036, 3038));
        assert_eq!((quote.bids[4].price, quote.asks[4].volume), (3032, 24));
        assert_eq!((quote.speed, quote.active2), (-12, 7));
    }
}

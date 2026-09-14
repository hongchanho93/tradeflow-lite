use super::{Market, Standard};
use crate::tdx::error::TdxError;
use crate::tdx::request::Request;
use crate::tdx::types::{SecurityCode, TdxDateTime};
use crate::tdx::wire::{ByteReader, ByteWriter};

/// 单次 K 线请求的最大条数；更多数据用 `offset` 分页。
pub const MAX_BARS_PER_REQUEST: u16 = 800;

/// K 线周期，值为协议里的周期编号。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BarPeriod {
    Minute1,
    Minute5,
    Minute15,
    Minute30,
    Minute60,
    Day,
    Week,
    Month,
}

impl BarPeriod {
    pub fn code(self) -> u16 {
        match self {
            Self::Minute5 => 0,
            Self::Minute15 => 1,
            Self::Minute30 => 2,
            Self::Minute60 => 3,
            Self::Week => 5,
            Self::Month => 6,
            Self::Minute1 => 7,
            Self::Day => 9,
        }
    }

    /// 分钟级周期的 K 线时间带分钟，日线及以上只有日期。
    pub fn is_intraday(self) -> bool {
        matches!(
            self,
            Self::Minute1 | Self::Minute5 | Self::Minute15 | Self::Minute30 | Self::Minute60
        )
    }
}

/// 一根未经处理的 K 线。价格单位是元；日线及以上的成交量单位是手，分钟线是股。
#[derive(Clone, Debug, PartialEq)]
pub struct RawBar {
    pub time: TdxDateTime,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    pub amount: f64,
}

/// 指数 K 线，额外带上涨和下跌家数。
#[derive(Clone, Debug, PartialEq)]
pub struct IndexBar {
    pub bar: RawBar,
    pub advancers: u16,
    pub decliners: u16,
}

/// 股票、ETF 等证券的 K 线，从最新一根往前数 `offset` 根开始取 `count` 根。
#[derive(Clone, Debug)]
pub struct SecurityBars {
    pub market: Market,
    pub code: SecurityCode,
    pub period: BarPeriod,
    pub offset: u16,
    pub count: u16,
}

/// 指数 K 线。请求格式与 [`SecurityBars`] 相同，响应每根多 4 字节涨跌家数。
#[derive(Clone, Debug)]
pub struct IndexBars {
    pub market: Market,
    pub code: SecurityCode,
    pub period: BarPeriod,
    pub offset: u16,
    pub count: u16,
}

impl Request for SecurityBars {
    type Dialect = Standard;
    type Response = Vec<RawBar>;
    const COMMAND: u16 = 0x052d;

    fn encode(&self, body: &mut ByteWriter) -> Result<(), TdxError> {
        encode_bars_request(
            body,
            self.market,
            &self.code,
            self.period,
            self.offset,
            self.count,
        )
    }

    fn decode(&self, body: &mut ByteReader<'_>) -> Result<Vec<RawBar>, TdxError> {
        let count = body.u16()?;
        let mut decoder = BarDecoder::new(self.period);
        (0..count).map(|_| decoder.next(body)).collect()
    }
}

impl Request for IndexBars {
    type Dialect = Standard;
    type Response = Vec<IndexBar>;
    const COMMAND: u16 = 0x052d;

    fn encode(&self, body: &mut ByteWriter) -> Result<(), TdxError> {
        encode_bars_request(
            body,
            self.market,
            &self.code,
            self.period,
            self.offset,
            self.count,
        )
    }

    fn decode(&self, body: &mut ByteReader<'_>) -> Result<Vec<IndexBar>, TdxError> {
        let count = body.u16()?;
        let mut decoder = BarDecoder::new(self.period);
        (0..count)
            .map(|_| {
                let bar = decoder.next(body)?;
                Ok(IndexBar {
                    bar,
                    advancers: body.u16()?,
                    decliners: body.u16()?,
                })
            })
            .collect()
    }
}

fn encode_bars_request(
    body: &mut ByteWriter,
    market: Market,
    code: &SecurityCode,
    period: BarPeriod,
    offset: u16,
    count: u16,
) -> Result<(), TdxError> {
    if count == 0 || count > MAX_BARS_PER_REQUEST {
        return Err(TdxError::InvalidArgument(format!(
            "bar count must be 1..={MAX_BARS_PER_REQUEST}, got {count}"
        )));
    }
    body.u16(u16::from(market.code()))
        .bytes(code.as_bytes())
        .u16(period.code())
        .u16(1)
        .u16(offset)
        .u16(count)
        .u32(0)
        .u32(0)
        .u16(0);
    Ok(())
}

/// K 线价格是相对编码：开盘价相对上一根收盘价，其余三价相对本根开盘价，单位为厘。
struct BarDecoder {
    period: BarPeriod,
    previous_close: i64,
}

impl BarDecoder {
    fn new(period: BarPeriod) -> Self {
        Self {
            period,
            previous_close: 0,
        }
    }

    fn next(&mut self, body: &mut ByteReader<'_>) -> Result<RawBar, TdxError> {
        let time = TdxDateTime::read_bar_time(body, self.period.is_intraday())?;
        let open = self.previous_close + body.varint()?;
        let close = open + body.varint()?;
        let high = open + body.varint()?;
        let low = open + body.varint()?;
        let volume = body.f32()?;
        let amount = body.f32()?;
        self.previous_close = close;
        Ok(RawBar {
            time,
            open: milli_to_yuan(open),
            high: milli_to_yuan(high),
            low: milli_to_yuan(low),
            close: milli_to_yuan(close),
            volume,
            amount,
        })
    }
}

fn milli_to_yuan(value: i64) -> f64 {
    value as f64 / 1000.0
}

#[cfg(test)]
mod tests {
    use super::{BarPeriod, IndexBars, Market, SecurityBars};
    use crate::tdx::request::Request;
    use crate::tdx::types::{SecurityCode, TdxDate};
    use crate::tdx::wire::{ByteReader, ByteWriter, encode_varint};

    fn request(period: BarPeriod) -> SecurityBars {
        SecurityBars {
            market: Market::Shanghai,
            code: SecurityCode::new("600000").unwrap(),
            period,
            offset: 800,
            count: 2,
        }
    }

    #[test]
    fn request_body_layout() {
        let mut body = ByteWriter::new();
        request(BarPeriod::Day).encode(&mut body).unwrap();
        assert_eq!(
            body.as_slice(),
            &[
                1, 0, b'6', b'0', b'0', b'0', b'0', b'0', 9, 0, 1, 0, 0x20, 0x03, 2, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0
            ]
        );
        let mut too_many = request(BarPeriod::Day);
        too_many.count = 801;
        assert!(too_many.encode(&mut ByteWriter::new()).is_err());
    }

    fn encode_row(out: &mut Vec<u8>, date: u32, diffs: [i64; 4], volume: f32, amount: f32) {
        out.extend_from_slice(&date.to_le_bytes());
        for diff in diffs {
            encode_varint(diff, out);
        }
        out.extend_from_slice(&volume.to_le_bytes());
        out.extend_from_slice(&amount.to_le_bytes());
    }

    #[test]
    fn prices_chain_from_previous_close() {
        let mut bytes = vec![2, 0];
        // 第一根：开 10.000（相对 0），收 +0.500，高 +0.800，低 -0.100。
        encode_row(
            &mut bytes,
            20_260_910,
            [10_000, 500, 800, -100],
            100.0,
            1_000.0,
        );
        // 第二根：开相对上一收盘 -0.200，收 +0.000，高 +0.300，低 -0.050。
        encode_row(&mut bytes, 20_260_911, [-200, 0, 300, -50], 200.0, 2_000.0);

        let bars = request(BarPeriod::Day)
            .decode(&mut ByteReader::new(&bytes))
            .unwrap();
        assert_eq!(bars.len(), 2);
        assert_eq!(
            bars[0].time.date,
            TdxDate {
                year: 2026,
                month: 9,
                day: 10
            }
        );
        assert_eq!(
            (bars[0].open, bars[0].close, bars[0].high, bars[0].low),
            (10.0, 10.5, 10.8, 9.9)
        );
        assert_eq!(
            (bars[1].open, bars[1].close, bars[1].high, bars[1].low),
            (10.3, 10.3, 10.6, 10.25)
        );
        assert_eq!((bars[1].volume, bars[1].amount), (200.0, 2_000.0));
        assert!(
            request(BarPeriod::Day)
                .decode(&mut ByteReader::new(&[0, 0]))
                .unwrap()
                .is_empty()
        );

        let index = IndexBars {
            market: Market::Shanghai,
            code: SecurityCode::new("000001").unwrap(),
            period: BarPeriod::Day,
            offset: 0,
            count: 2,
        };
        assert!(
            index.decode(&mut ByteReader::new(&bytes)).is_err(),
            "index bars carry 4 extra bytes per row"
        );
        let mut index_bytes = vec![1, 0];
        encode_row(
            &mut index_bytes,
            20_260_910,
            [10_000, 500, 800, -100],
            100.0,
            1_000.0,
        );
        index_bytes.extend_from_slice(&[12, 0, 34, 0]);
        let rows = index.decode(&mut ByteReader::new(&index_bytes)).unwrap();
        assert_eq!((rows[0].advancers, rows[0].decliners), (12, 34));
        assert_eq!(rows[0].bar.close, 10.5);
    }
}

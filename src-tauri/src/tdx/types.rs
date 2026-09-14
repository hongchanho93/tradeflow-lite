use std::fmt;

use super::error::TdxError;
use super::wire::ByteReader;

/// 标准行情里的 6 字节证券代码（股票、ETF、指数、板块指数）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SecurityCode([u8; 6]);

impl SecurityCode {
    pub fn new(code: &str) -> Result<Self, TdxError> {
        let bytes: [u8; 6] = code.as_bytes().try_into().map_err(|_| {
            TdxError::InvalidArgument(format!("security code must be 6 bytes: {code:?}"))
        })?;
        if !bytes.iter().all(u8::is_ascii_alphanumeric) {
            return Err(TdxError::InvalidArgument(format!(
                "security code must be ASCII alphanumeric: {code:?}"
            )));
        }
        Ok(Self(bytes))
    }

    pub fn from_bytes(bytes: [u8; 6]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 6] {
        &self.0
    }
}

impl fmt::Display for SecurityCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&String::from_utf8_lossy(&self.0))
    }
}

/// 协议里的日历日期，不含时区。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TdxDate {
    pub year: u16,
    pub month: u8,
    pub day: u8,
}

impl TdxDate {
    /// `u32` 形式的 `YYYYMMDD`。
    pub fn read_yyyymmdd(reader: &mut ByteReader<'_>) -> Result<Self, TdxError> {
        let packed = reader.u32()?;
        Ok(Self {
            year: (packed / 10_000) as u16,
            month: (packed / 100 % 100) as u8,
            day: (packed % 100) as u8,
        })
    }
}

/// 协议里的交易所本地时间（北京时间），不含时区。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TdxDateTime {
    pub date: TdxDate,
    pub hour: u8,
    pub minute: u8,
}

impl TdxDateTime {
    /// K 线时间。分钟级周期是 `u16` 压缩日期加 `u16` 当日分钟数；
    /// 日线及以上周期是 `u32` 的 `YYYYMMDD`，时间固定记为收盘 15:00。
    pub fn read_bar_time(reader: &mut ByteReader<'_>, intraday: bool) -> Result<Self, TdxError> {
        if intraday {
            let packed_date = reader.u16()?;
            let minutes = reader.u16()?;
            let month_day = packed_date % 2048;
            Ok(Self {
                date: TdxDate {
                    year: (packed_date >> 11) + 2004,
                    month: (month_day / 100) as u8,
                    day: (month_day % 100) as u8,
                },
                hour: (minutes / 60) as u8,
                minute: (minutes % 60) as u8,
            })
        } else {
            Ok(Self {
                date: TdxDate::read_yyyymmdd(reader)?,
                hour: 15,
                minute: 0,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{SecurityCode, TdxDate, TdxDateTime};
    use crate::tdx::wire::ByteReader;

    #[test]
    fn security_code_requires_six_ascii_characters() {
        assert_eq!(SecurityCode::new("600000").unwrap().to_string(), "600000");
        assert!(SecurityCode::new("60000").is_err());
        assert!(SecurityCode::new("60000０").is_err());
    }

    #[test]
    fn bar_time_decodes_intraday_and_daily_layouts() {
        // 2026-09-11 14:35：(2026-2004)<<11 | 911，14*60+35。
        let packed = ((22u16 << 11) | 911).to_le_bytes();
        let minutes = (14u16 * 60 + 35).to_le_bytes();
        let bytes = [packed[0], packed[1], minutes[0], minutes[1]];
        let intraday = TdxDateTime::read_bar_time(&mut ByteReader::new(&bytes), true).unwrap();
        assert_eq!(
            intraday,
            TdxDateTime {
                date: TdxDate {
                    year: 2026,
                    month: 9,
                    day: 11
                },
                hour: 14,
                minute: 35
            }
        );

        let daily_bytes = 19_901_219u32.to_le_bytes();
        let daily = TdxDateTime::read_bar_time(&mut ByteReader::new(&daily_bytes), false).unwrap();
        assert_eq!(
            daily.date,
            TdxDate {
                year: 1990,
                month: 12,
                day: 19
            }
        );
        assert_eq!((daily.hour, daily.minute), (15, 0));
    }
}

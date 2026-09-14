use super::{Market, Standard};
use crate::tdx::error::TdxError;
use crate::tdx::request::Request;
use crate::tdx::types::{SecurityCode, TdxDate};
use crate::tdx::wire::{ByteReader, ByteWriter};

/// 除权除息及股本变动记录。
#[derive(Clone, Debug)]
pub struct XdxrInfo {
    pub market: Market,
    pub code: SecurityCode,
}

#[derive(Clone, Debug, PartialEq)]
pub struct XdxrEntry {
    pub date: TdxDate,
    /// 协议类别编号：1 除权除息，2 送配股上市，3 非流通股上市，4 未知股本变动，
    /// 5 股本变化，6 增发新股，7 股份回购，8 增发新股上市，9 转配股上市，
    /// 10 可转债上市，11 扩缩股，12 非流通股缩股，13 送认购权证，14 送认沽权证。
    pub category: u8,
    pub detail: XdxrDetail,
}

/// 按类别解析出的 16 字节明细。
#[derive(Clone, Debug, PartialEq)]
pub enum XdxrDetail {
    /// 类别 1。数值均为每 10 股口径。
    Dividend {
        cash: f64,
        rights_price: f64,
        bonus_shares: f64,
        rights_shares: f64,
    },
    /// 类别 11、12。
    Consolidation { ratio: f64 },
    /// 类别 13、14。
    Warrant { exercise_price: f64, shares: f64 },
    /// 其余类别：变动前后的流通股与总股本。
    ShareChange {
        float_before: f64,
        total_before: f64,
        float_after: f64,
        total_after: f64,
    },
}

impl Request for XdxrInfo {
    type Dialect = Standard;
    type Response = Vec<XdxrEntry>;
    const COMMAND: u16 = 0x000f;

    fn encode(&self, body: &mut ByteWriter) -> Result<(), TdxError> {
        body.u16(1)
            .u8(self.market.code())
            .bytes(self.code.as_bytes());
        Ok(())
    }

    fn decode(&self, body: &mut ByteReader<'_>) -> Result<Vec<XdxrEntry>, TdxError> {
        // 没有记录时主站只回显请求头。
        if body.remaining() < 11 {
            return Ok(Vec::new());
        }
        // 回显的 u16 数量 + 市场 + 代码。
        body.skip(9)?;
        let count = body.u16()?;
        (0..count).map(|_| decode_entry(body)).collect()
    }
}

fn decode_entry(body: &mut ByteReader<'_>) -> Result<XdxrEntry, TdxError> {
    // 市场、代码和 1 个保留字节。
    body.skip(8)?;
    let date = TdxDate::read_yyyymmdd(body)?;
    let category = body.u8()?;
    let detail = match category {
        1 => XdxrDetail::Dividend {
            cash: body.f32()?,
            rights_price: body.f32()?,
            bonus_shares: body.f32()?,
            rights_shares: body.f32()?,
        },
        11 | 12 => {
            body.skip(8)?;
            let ratio = body.f32()?;
            body.skip(4)?;
            XdxrDetail::Consolidation { ratio }
        }
        13 | 14 => {
            let exercise_price = body.f32()?;
            body.skip(4)?;
            let shares = body.f32()?;
            body.skip(4)?;
            XdxrDetail::Warrant {
                exercise_price,
                shares,
            }
        }
        _ => XdxrDetail::ShareChange {
            float_before: body.f32()?,
            total_before: body.f32()?,
            float_after: body.f32()?,
            total_after: body.f32()?,
        },
    };
    Ok(XdxrEntry {
        date,
        category,
        detail,
    })
}

#[cfg(test)]
mod tests {
    use super::{Market, XdxrDetail, XdxrInfo};
    use crate::tdx::request::Request;
    use crate::tdx::types::{SecurityCode, TdxDate};
    use crate::tdx::wire::ByteReader;

    fn row(date: u32, category: u8, payload: [u8; 16]) -> Vec<u8> {
        let mut bytes = vec![1];
        bytes.extend_from_slice(b"600000");
        bytes.push(0);
        bytes.extend_from_slice(&date.to_le_bytes());
        bytes.push(category);
        bytes.extend_from_slice(&payload);
        bytes
    }

    fn floats(values: [f32; 4]) -> [u8; 16] {
        let mut out = [0u8; 16];
        for (index, value) in values.iter().enumerate() {
            out[index * 4..index * 4 + 4].copy_from_slice(&value.to_le_bytes());
        }
        out
    }

    #[test]
    fn entries_decode_by_category() {
        let request = XdxrInfo {
            market: Market::Shanghai,
            code: SecurityCode::new("600000").unwrap(),
        };
        let mut bytes = vec![1, 0, 1];
        bytes.extend_from_slice(b"600000");
        bytes.extend_from_slice(&[3, 0]);
        bytes.extend(row(20_250_710, 1, floats([4.1, 0.0, 3.0, 0.0])));
        bytes.extend(row(20_260_203, 11, floats([0.0, 0.0, 3.0, 0.0])));
        bytes.extend(row(20_200_101, 5, floats([0.0, 0.0, 100.0, 200.0])));

        let entries = request.decode(&mut ByteReader::new(&bytes)).unwrap();
        assert_eq!(
            entries[0].date,
            TdxDate {
                year: 2025,
                month: 7,
                day: 10
            }
        );
        assert_eq!(
            entries[0].detail,
            XdxrDetail::Dividend {
                cash: f64::from(4.1f32),
                rights_price: 0.0,
                bonus_shares: 3.0,
                rights_shares: 0.0
            }
        );
        assert_eq!(entries[1].detail, XdxrDetail::Consolidation { ratio: 3.0 });
        assert_eq!(
            entries[2].detail,
            XdxrDetail::ShareChange {
                float_before: 0.0,
                total_before: 0.0,
                float_after: 100.0,
                total_after: 200.0
            }
        );

        assert!(
            request
                .decode(&mut ByteReader::new(&bytes[..9]))
                .unwrap()
                .is_empty()
        );
    }
}

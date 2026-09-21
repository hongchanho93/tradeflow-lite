//! 北京时间与 Unix 时间戳互转。
//!
//! 中国在 1986–1991 年实行过夏令时（UTC+9），上证指数日线从 1990 年开始，
//! 所以不能简单地固定 UTC+8。

use chrono::{DateTime, Datelike, NaiveDate, NaiveDateTime, NaiveTime, Utc};

/// 每年夏令时的开始日和结束日：开始日 03:00 起为 UTC+9，结束日 02:00 起恢复 UTC+8。
const DAYLIGHT_SAVING: [(i32, (u32, u32), (u32, u32)); 6] = [
    (1986, (5, 4), (9, 14)),
    (1987, (4, 12), (9, 13)),
    (1988, (4, 17), (9, 11)),
    (1989, (4, 16), (9, 17)),
    (1990, (4, 15), (9, 16)),
    (1991, (4, 14), (9, 15)),
];

const HOUR: i64 = 3_600;

fn offset_seconds(local: NaiveDateTime) -> i64 {
    let Some(&(_, (start_month, start_day), (end_month, end_day))) = DAYLIGHT_SAVING
        .iter()
        .find(|(year, _, _)| *year == local.year())
    else {
        return 8 * HOUR;
    };
    let boundary = |month, day, hour| {
        NaiveDate::from_ymd_opt(local.year(), month, day)
            .and_then(|date| date.and_hms_opt(hour, 0, 0))
            .expect("valid daylight saving boundary")
    };
    let start = boundary(start_month, start_day, 3);
    let end = boundary(end_month, end_day, 2);
    if local >= start && local < end {
        9 * HOUR
    } else {
        8 * HOUR
    }
}

pub(crate) fn shanghai_timestamp(date: NaiveDate, hour: u32, minute: u32) -> Option<i64> {
    let local = date.and_time(NaiveTime::from_hms_opt(hour, minute, 0)?);
    Some(local.and_utc().timestamp() - offset_seconds(local))
}

pub(crate) fn shanghai_date(timestamp: i64) -> NaiveDate {
    let standard = DateTime::<Utc>::from_timestamp(timestamp + 8 * HOUR, 0)
        .expect("timestamp in range")
        .naive_utc();
    let daylight = standard + chrono::Duration::hours(1);
    if offset_seconds(daylight) == 9 * HOUR {
        daylight.date()
    } else {
        standard.date()
    }
}

pub(crate) fn shanghai_today() -> NaiveDate {
    shanghai_date(Utc::now().timestamp())
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::{shanghai_date, shanghai_timestamp};

    fn date(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    #[test]
    fn modern_dates_use_utc_plus_eight() {
        assert_eq!(
            shanghai_timestamp(date(2026, 9, 12), 15, 0),
            Some(1_789_196_400)
        );
        assert_eq!(shanghai_date(1_789_196_400), date(2026, 9, 12));
        assert_eq!(shanghai_date(1_789_142_400 - 1), date(2026, 9, 11));
    }

    #[test]
    fn early_nineties_follow_china_daylight_saving() {
        // 与 Python zoneinfo("Asia/Shanghai") 的结果逐一核对过。
        assert_eq!(
            shanghai_timestamp(date(1990, 12, 19), 15, 0),
            Some(661_590_000)
        );
        assert_eq!(
            shanghai_timestamp(date(1991, 7, 1), 15, 0),
            Some(678_348_000)
        );
        assert_eq!(
            shanghai_timestamp(date(1991, 4, 14), 1, 0),
            Some(671_562_000)
        );
        assert_eq!(
            shanghai_timestamp(date(1991, 4, 14), 3, 0),
            Some(671_565_600)
        );
        assert_eq!(
            shanghai_timestamp(date(1991, 9, 15), 1, 0),
            Some(684_864_000)
        );
        assert_eq!(
            shanghai_timestamp(date(1991, 9, 15), 2, 0),
            Some(684_871_200)
        );
        assert_eq!(shanghai_date(678_348_000), date(1991, 7, 1));
        assert_eq!(shanghai_date(678_294_000), date(1991, 7, 1));
        assert_eq!(shanghai_date(678_294_000 - 1), date(1991, 6, 30));
        // 月末日期不能在换算夏令时边界时构造出不存在的日期。
        assert_eq!(
            shanghai_timestamp(date(1991, 1, 31), 15, 0),
            Some(665_305_200)
        );
        assert_eq!(shanghai_date(665_305_200), date(1991, 1, 31));
    }
}

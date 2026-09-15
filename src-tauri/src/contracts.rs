use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Symbol(String);

impl Symbol {
    pub fn new(exchange: &str, code: &str) -> Result<Self, AppError> {
        let exchange = normalize_symbol_component(exchange, 32)?;
        let code = normalize_symbol_component(code, 96)?;
        if exchange.is_empty() || code.is_empty() {
            return Err(AppError::new("invalid_symbol", "不支持的行情品种代码"));
        }
        Ok(Self(format!("{exchange}:{code}")))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn parts(&self) -> (&str, &str) {
        self.0
            .split_once(':')
            .expect("validated symbol contains separator")
    }
}

fn normalize_symbol_component(value: &str, max_chars: usize) -> Result<String, AppError> {
    if value.is_empty()
        || value.chars().count() > max_chars
        || value.chars().any(|character| {
            (!character.is_ascii_alphanumeric() && !matches!(character, '.' | '_' | '-'))
                || character.is_control()
                || character.is_whitespace()
        })
    {
        return Err(AppError::new("invalid_symbol", "不支持的行情品种代码"));
    }
    Ok(value.to_ascii_uppercase())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SymbolKind {
    Stock,
    Etf,
    Index,
    Crypto,
}

impl SymbolKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Stock => "stock",
            Self::Etf => "etf",
            Self::Index => "index",
            Self::Crypto => "crypto",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolInfo {
    pub symbol: Symbol,
    pub name: String,
    pub kind: SymbolKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinanceSpotSymbol {
    pub symbol: String,
    pub base_asset: String,
    pub quote_asset: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinanceUsdMarginedSymbol {
    pub symbol: String,
    pub base_asset: String,
    pub quote_asset: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Resolution {
    #[serde(rename = "1")]
    Minute1,
    #[serde(rename = "5")]
    Minute5,
    #[serde(rename = "15")]
    Minute15,
    #[serde(rename = "30")]
    Minute30,
    #[serde(rename = "60")]
    Minute60,
    #[serde(rename = "1D")]
    Day,
    #[serde(rename = "1W")]
    Week,
    #[serde(rename = "1M")]
    Month,
}

impl Resolution {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Minute1 => "1",
            Self::Minute5 => "5",
            Self::Minute15 => "15",
            Self::Minute30 => "30",
            Self::Minute60 => "60",
            Self::Day => "1D",
            Self::Week => "1W",
            Self::Month => "1M",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Adjustment {
    None,
    Qfq,
}

impl Adjustment {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Qfq => "qfq",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bar {
    pub time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<f64>,
}

impl Bar {
    pub fn new(
        time: i64,
        open: f64,
        high: f64,
        low: f64,
        close: f64,
        volume: f64,
        amount: Option<f64>,
    ) -> Self {
        Self {
            time,
            open,
            high,
            low,
            close,
            volume,
            amount,
        }
    }

    pub fn validate_series(bars: &[Self]) -> Result<(), AppError> {
        Self::validate_series_with_price_floor(bars, true)
    }

    pub fn validate_adjusted_series(bars: &[Self]) -> Result<(), AppError> {
        Self::validate_series_with_price_floor(bars, false)
    }

    fn validate_series_with_price_floor(
        bars: &[Self],
        require_positive_prices: bool,
    ) -> Result<(), AppError> {
        let mut previous_time = None;
        for bar in bars {
            if previous_time == Some(bar.time) {
                return Err(AppError::new("duplicate_time", "K 线时间不能重复"));
            }
            if previous_time.is_some_and(|time| time > bar.time) {
                return Err(AppError::new("out_of_order", "K 线必须按时间升序排列"));
            }
            let prices = [bar.open, bar.high, bar.low, bar.close];
            let invalid_number = prices
                .into_iter()
                .any(|value| !value.is_finite() || (require_positive_prices && value <= 0.0))
                || !bar.volume.is_finite()
                || bar.volume < 0.0
                || bar
                    .amount
                    .is_some_and(|value| !value.is_finite() || value < 0.0);
            let invalid_range = bar.high < bar.open.max(bar.close)
                || bar.low > bar.open.min(bar.close)
                || bar.high < bar.low;
            if invalid_number || invalid_range {
                return Err(AppError::new("invalid_ohlc", "K 线价格或成交量不合法"));
            }
            previous_time = Some(bar.time);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub symbol: Symbol,
    pub last: f64,
    pub timestamp: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Adjustment, Bar, Resolution, Symbol, SymbolInfo, SymbolKind};

    #[test]
    fn daily_bars_require_unique_ascending_times_and_valid_ohlc() {
        let valid = vec![
            Bar::new(1_757_257_200, 10.0, 10.8, 9.9, 10.5, 1200.0, Some(12_500.0)),
            Bar::new(1_757_343_600, 10.5, 11.0, 10.3, 10.9, 1500.0, None),
        ];
        assert!(Bar::validate_series(&valid).is_ok());

        let duplicate = vec![valid[0].clone(), valid[0].clone()];
        assert_eq!(
            Bar::validate_series(&duplicate).unwrap_err().code,
            "duplicate_time"
        );

        let invalid_ohlc = vec![Bar::new(1_757_257_200, 10.0, 9.8, 9.9, 10.5, 1.0, None)];
        assert_eq!(
            Bar::validate_series(&invalid_ohlc).unwrap_err().code,
            "invalid_ohlc"
        );

        let negative_adjusted = vec![Bar::new(1_757_257_200, -0.2, -0.1, -0.5, -0.3, 1.0, None)];
        assert_eq!(
            Bar::validate_series(&negative_adjusted).unwrap_err().code,
            "invalid_ohlc"
        );
        assert!(Bar::validate_adjusted_series(&negative_adjusted).is_ok());
    }

    #[test]
    fn public_contract_serializes_stable_wire_values() {
        let info = SymbolInfo {
            symbol: Symbol::new("SH", "600000").unwrap(),
            name: "浦发银行".to_string(),
            kind: SymbolKind::Stock,
        };
        assert_eq!(serde_json::to_value(info).unwrap()["symbol"], "SH:600000");
        assert_eq!(serde_json::to_value(Resolution::Day).unwrap(), "1D");
        assert_eq!(serde_json::to_value(Adjustment::None).unwrap(), "none");
        assert_eq!(
            serde_json::to_value(Symbol::new("binance", "btcusdt").unwrap()).unwrap(),
            "BINANCE:BTCUSDT"
        );
        assert_eq!(serde_json::to_value(SymbolKind::Crypto).unwrap(), "crypto");
        assert_eq!(
            Symbol::new("EXAMPLE", "ABC-USD").unwrap().as_str(),
            "EXAMPLE:ABC-USD"
        );
        assert!(Symbol::new("EXAMPLE", "A/B").is_err());
        assert!(Symbol::new("SH", "600:000").is_err());
        assert!(Symbol::new("SH", "600 000").is_err());
        assert!(Symbol::new("SH", "600000\n").is_err());
        assert!(Symbol::new("SH:OTHER", "600000").is_err());
        assert!(Symbol::new("SH", &"X".repeat(97)).is_err());
        assert!(Symbol::new(&"X".repeat(33), "600000").is_err());
    }
}

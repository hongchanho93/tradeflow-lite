//! TradeFlow Lite 自有的通达信（TDX）行情协议客户端。
//!
//! 分层（由下到上），每一层只依赖它下面的层：
//!
//! - [`wire`]：字节读写，以及协议里的数值编码（变长价格、f32 数量、压缩日期）。
//! - `frame`：请求包头、响应包头、zlib 解压；与具体命令无关。
//! - [`Dialect`]：一种主站协议方言，决定包头标记字节和握手流程。
//!   目前只有标准行情 [`standard::Standard`]（沪深京股票、ETF、指数，端口 7709）。
//! - [`Request`]：一个协议命令就是一个实现了 `Request` 的结构体，
//!   自己负责请求体编码和响应体解码。
//! - [`Client`] / [`Session`]：建立连接、握手、发送任意 `Request`。
//!
//! 扩展方式：
//!
//! - **新增命令**：在对应方言目录（如 `standard/`）下新增一个文件，定义请求结构体并实现
//!   `Request`，再在该目录的 `mod.rs` 里导出。`client`、`frame`、`wire` 均不需要改动。
//! - **新增方言**（例如期货和扩展指数所在的扩展行情主站）：新建一个目录，实现
//!   `Dialect`（包头标记与握手），命令同上逐个添加。类型系统保证某个方言的命令
//!   只能发给该方言的连接。
//! - **握手变体**：用 [`Client::connect_raw`] 建立不握手的连接，再按需发送握手命令。
//!
//! 全部可用命令及其命令号的盘点见 `docs/TDX 协议能力盘点与扩展指南.md`。

mod client;
mod error;
mod frame;
mod request;
pub mod standard;
mod types;
pub mod wire;

pub use client::{Client, Session};
pub use error::TdxError;
pub use request::{Dialect, Request};
pub use types::{SecurityCode, TdxDate, TdxDateTime};

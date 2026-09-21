# 第三方许可证与声明

[English](THIRD_PARTY_LICENSES.md)

本页为第三方清单的中文说明，不替代上游许可证原文，也不替项目整体授予许可证。

| 组件 | 当前清单中的许可 |
| --- | --- |
| TradingView Lightweight Charts 5.2.1 | Apache-2.0 |
| difurious Lightweight Charts Line Tools Core 1.1.2 | MPL-2.0 |
| difurious Lines、Rectangle、Circle、Fib Retracement、Freehand、Parallel Channel、Price Range、Long/Short Position、Text 1.1.0 | MPL-2.0 |
| chrono 0.4 | MIT 或 Apache-2.0 |
| flate2 1.1 | MIT 或 Apache-2.0 |

独立仓库中的 [`tradeflow-tdx`](https://github.com/hongchanho93/tradeflow-tdx) 为 TradeFlow 自行实现的 TDX 行情协议代码。维护者于 2026-09-22 确认：该实现为独立原创，没有复制、翻译或改写其他 TDX 客户端，也不捆绑或依赖第三方 TDX 客户端。该 crate 单独采用 `MIT OR Apache-2.0` 双许可证。

SQLite/Parquet 读取还涉及 Cargo.lock 中的 rusqlite 0.40.2（bundled SQLite）、sqlite-vfs 0.2.0、Apache parquet 58.1.0、bytes、snap、zstd、lz4_flex、brotli；flate2 提供 Rust gzip 后端。这是来源记录，不代表已完成分发许可证或漏洞审计，直接与间接依赖的实际声明都需核对。

维护者于 2026-09-22 确认应用 UI 为自行设计绘制，并进一步确认：14 个正式使用的 SVG 是先由维护者独立绘制，之后才复制进本地参考目录。这 14 个文件包括 5 个 K 线类型图标、`drawing-tools/extended-line.svg` 和 8 个 widget-bar 图标，现记录为 TradeFlow 原创素材。单独的 242 文件参考目录已不再由本仓库跟踪或分发。

清单尚不完整，安装包分发许可审计仍未完成。根项目采用 MPL-2.0 不会替代第三方义务，也不代表安装包已经达到发布条件。必须保留上游 LICENSE、NOTICE 和版权声明，不能用本页代替它们。

fn main() {
    println!("cargo:rerun-if-env-changed=TRADEFLOW_LITE_EDITION");
    println!("cargo:rustc-check-cfg=cfg(tradeflow_tdx)");
    let has_tdx = std::env::var_os("CARGO_FEATURE_PROVIDER_TDX").is_some();
    let edition = std::env::var("TRADEFLOW_LITE_EDITION")
        .unwrap_or_else(|_| if has_tdx { "cn" } else { "global" }.to_string());
    match (edition.as_str(), has_tdx) {
        ("cn", true) => println!("cargo:rustc-cfg=tradeflow_tdx"),
        ("cn", false) => panic!("CN edition requires the provider-tdx Cargo feature"),
        ("global", false) => {}
        ("global", true) => {
            panic!("Global edition must not compile the provider-tdx Cargo feature")
        }
        (name, _) => panic!("unsupported TradeFlow Lite edition: {name}"),
    }
    tauri_build::build()
}

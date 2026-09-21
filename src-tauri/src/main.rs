#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--mcp-stdio") {
        std::process::exit(tradeflow_lite_lib::ai_mcp::run_stdio());
    }
    tradeflow_lite_lib::run();
}

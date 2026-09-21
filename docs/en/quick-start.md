# Getting started with TradeFlow Lite

[简体中文](../zh-CN/quick-start.md) · [Home](../../README.md)

## Choose an installation path

Check [GitHub Releases](https://github.com/hongchanho93/tradeflow-lite/releases) for an installer matching your operating system and processor. Follow that release's installation and signing notes. If there is no matching installer, the available route is building from source; the automatic “Source code” ZIP is not a desktop installer.

Choose the edition separately from the UI language. **Global** is the normal default for international users and does not compile or package TDX. **CN** compiles and enables TDX A-shares together with the other reference providers. Both use the same adapter interfaces; compiled providers can later be enabled or disabled under **Settings → Data sources**.

The base development configuration uses a development application identifier and keeps installer bundling disabled. `tauri:build:cn` and `tauri:build:global` merge the release configuration, switch to the release identifier and enable bundling. This still does not establish that a signed macOS or Windows package has been published. Linux compatibility and platform-specific credential storage must be checked separately, not inferred from Tauri's platform support.

To create and accept both Windows installers on a PC, follow [Local Windows build and acceptance](windows-local-build.md). The editions share one application identifier and are not side-by-side installations.

## Run the source checkout

You need Git, Node.js with npm, a Rust toolchain and the [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system. Use Node.js 22.18 or newer for the repository's direct TypeScript test scripts. The pinned Vite dependency requires Node.js `^20.19.0 || >=22.12.0`; that dependency minimum alone is not sufficient for all repository tests.

On macOS, install the required Xcode command-line tools. On Windows, follow Tauri's C++ build-tools and WebView2 requirements. On Linux, install the distribution-specific WebKit and native build dependencies in the upstream guide. Use current Rust stable unless the checkout supplies a stricter toolchain requirement. No Python service is required for market data.

```sh
git clone https://github.com/hongchanho93/tradeflow-lite.git
cd tradeflow-lite
npm ci
npm run tauri:dev:global
```

Use `npm run tauri:dev:cn` for CN. A plain `npm run tauri dev` does not enable the TDX Cargo feature and therefore follows the Global build boundary; use the named scripts for reproducible edition builds. Release builds use `npm run tauri:build:cn` or `npm run tauri:build:global` and merge `src-tauri/tauri.release.conf.json`. A tag-triggered GitHub workflow can build both editions for macOS and Windows as a **draft** release; signing/notarization still needs the release owner's platform credentials.

Private repository access is required until publication. Run these commands inside your checkout. `npm ci` follows the lockfile rather than upgrading dependencies. Some pinned chart-tool dependencies are fetched from GitHub, so dependency installation also needs GitHub connectivity.

`npm run dev` starts Vite only. Open the Tauri desktop application to use native market data, OS credential storage and selected local files. A successful frontend build does not create a signed installer or update an already installed app.

## Open your first chart

Choose a market/provider and search for a symbol. Select a timeframe, then check the symbol, source and connection status before interpreting the chart. TDX-specific adjustment controls exist only in CN and are shown only when TDX is enabled and selected. Global contains no TDX provider, catalog or controls. Allow initial history to load; loading more bars does not imply all historical data is available.

Add a built-in indicator from the indicator picker, draw a line and add the symbol to your watchlist. Workspace preferences and supported chart objects are saved locally. For custom indicators, use an importable `.tfi` file rather than editing the application.

## Connect AI only when needed

Open **AI** in the right sidebar, then **Settings**. Choose a provider and model, enter your API key and save. Saving does not send a model request; sending a message does. An external MCP client is a separate option in the same settings page. See [AI and MCP](ai-guide.md) before sharing a pairing configuration.

Try: “Read the current chart and tell me its symbol, timeframe, actual data range and limitations.” Confirm that tool execution, not just generated text, appears in the conversation.

## When something does not work

For empty charts, check the selected provider, network and actual catalog status before concluding a symbol does not exist. For AI errors, check the protocol, complete request endpoint, model availability and credential status. Provider-side failures do not prove the chart app failed. For a local file error, use **AI → Settings → My Data** to select the directory through the system picker.

Report the app version or source commit, operating system, provider, steps and visible error. Remove API keys, MCP tokens and personal file paths from screenshots and logs. See the [FAQ](faq.md) for common boundaries.

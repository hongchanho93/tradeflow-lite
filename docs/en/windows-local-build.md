# Local Windows build and acceptance

[简体中文](../zh-CN/windows-local-build.md) · [Home](../../README.md) · [Quick start](quick-start.md)

This procedure is for the person building and accepting TradeFlow Lite on a Windows PC. It does not depend on cloud builds. The goal is to create the CN and Global Windows x64 installers from one candidate revision and verify both platform behavior and edition boundaries.

Windows and macOS share the frontend, business logic, Rust core and market adapters. The Windows-specific surface is intentionally small: WebView2, OS credential storage, the application data directory, file identities and path rules, installation and removal. A macOS pass is useful shared-core evidence, but it is not Windows desktop acceptance.

## 1. Receive an exact candidate

Before starting, obtain:

- the candidate source and full commit SHA;
- the features or fixes that this candidate is expected to contain;
- known unverified items, such as an installer that has not yet been Windows code-signed.

Do not edit source, upgrade dependencies or mix commits during acceptance. A source archive is not an installer.

In the project directory, record the current state in PowerShell:

```powershell
git rev-parse HEAD
git status --short
```

The reported revision must exactly match the candidate SHA. A release candidate should produce no output from `git status --short`. Stop and report any unexpected local changes before building.

## 2. Prepare Windows

The current acceptance target is Windows 10/11 x64. Windows ARM64 is outside this scope.

Install:

1. Git for Windows.
2. Node.js 22.18 or a newer 22.x release.
3. Rustup and the current stable MSVC toolchain.
4. Visual Studio 2022 Build Tools with **Desktop development with C++**, including MSVC and a Windows SDK.
5. Microsoft Edge WebView2 Runtime. Most Windows 10/11 systems already have it; otherwise follow the [Tauri 2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

Verify the environment:

```powershell
git --version
node --version
npm --version
rustc --version
cargo --version
rustup default stable-msvc
```

The bundled market adapters do not need Python. Some chart dependencies are pinned to Git commits, so the first `npm ci` needs npm and GitHub access.

## 3. Install locked dependencies and run pre-build checks

From the candidate root run:

```powershell
npm ci
npm run test:market-edition
npm run test:ui
npm run test:contracts
npm run build
$env:TRADEFLOW_LITE_EDITION = "global"
cargo test --manifest-path src-tauri/Cargo.toml --locked
$env:TRADEFLOW_LITE_EDITION = "cn"
cargo test --manifest-path src-tauri/Cargo.toml --locked --features provider-tdx
$env:TRADEFLOW_LITE_EDITION = $null
```

Every command must exit with status 0. `npm ci` follows the lockfile. Do not replace it with `npm install --force`, delete the lockfile or upgrade packages to hide a failure. Preserve the exact command, final error and candidate SHA for diagnosis.

These checks establish code and contract results in the Windows build environment. They do not prove that the installer works.

## 4. Build CN and Global separately

The editions share one product name, installer identity and output directory. Build one at a time and preserve its artifacts before starting the next.

Create an acceptance output root:

```powershell
$acceptanceRoot = Join-Path (Split-Path $PWD -Parent) "tradeflow-lite-windows-acceptance"
New-Item -ItemType Directory -Force $acceptanceRoot | Out-Null
```

### CN

```powershell
npm run tauri:build:cn
New-Item -ItemType Directory -Force "$acceptanceRoot\cn" | Out-Null
Copy-Item ".\src-tauri\target\release\bundle\*" "$acceptanceRoot\cn" -Recurse -Force
```

### Global

```powershell
npm run tauri:build:global
New-Item -ItemType Directory -Force "$acceptanceRoot\global" | Out-Null
Copy-Item ".\src-tauri\target\release\bundle\*" "$acceptanceRoot\global" -Recurse -Force
```

List the final files and calculate package hashes:

```powershell
Get-ChildItem $acceptanceRoot -Recurse -File
Get-ChildItem $acceptanceRoot -Recurse -File | Get-FileHash -Algorithm SHA256
```

Retain both directories, actual installer filenames, SHA-256 values and candidate SHA. A successful build log is not proof that artifacts were copied; the files must be visible in both directories.

`npm run dev` starts only the web frontend. It neither creates an installer nor replaces Tauri desktop acceptance.

## 5. Accept the installers in isolation

The editions are not side-by-side applications. A later installer may replace the previous edition, and uninstalling the app does not necessarily remove user workspace data.

Prefer a new Windows test account for each edition or restore the same clean virtual-machine snapshot. If only one ordinary machine is available, test in this order:

1. CN: install, accept and uninstall.
2. Global: install, accept and uninstall.

Do not delete personal directories to manufacture a clean state. Mark first-run defaults as not verified when a clean state is unavailable.

A local installer may not yet be Windows code-signed. Record Unknown Publisher or SmartScreen warnings and follow the authorized internal-testing policy. An unsigned internal build is not a signed release.

## 6. Verify edition defaults

After the first launch of each package, open **Settings → Data sources**:

| Package | Expected edition | Providers enabled by default on first use |
| --- | --- | --- |
| CN | TradeFlow Lite CN | TDX, Binance, OKX and Polymarket |
| Global | TradeFlow Lite Global | Binance, OKX and Polymarket; no TDX provider or TDX catalog |

UI language does not change the edition. Users may later enable or disable compiled adapters without changing packages. Global must not offer TDX in **Settings → Data sources**, search categories or search results.

## 7. Windows-specific acceptance

Install, launch and edition defaults apply to every package. Run the complete platform set once on CN and sample it on the other editions:

- **Install and window:** Start menu launch, the new logo, resizing, maximize, fullscreen and high-DPI rendering work.
- **Language:** switch between Chinese and English in Settings and confirm. The button immediately shows progress instead of appearing unresponsive, and the selected language survives restart. English Settings, indicators, watchlist, AI and errors contain no Chinese explanatory text except native security names.
- **Workspace:** change the theme, interval, watchlist, settings and one drawing. They return after restart and never cross into another Windows account.
- **OS credentials:** save a test AI API key and restart. The setting remains usable, while the UI and logs never expose the complete key. Dispose of the credential according to the test-account procedure.
- **Local files:** select a dedicated fixture directory through the system picker and exercise supported CSV, SQLite snapshot or Parquet input. The app remains limited to the selected directory.
- **Result files:** save a test result to a selected location and confirm that it exists and opens.
- **MCP:** enable external MCP and check it again after restart. Record Windows Firewall or security-product prompts; a blocked connection is not a pass.
- **Paths:** use an ordinary fixture directory containing spaces and non-ASCII characters. Never use real sensitive data.
- **Uninstall:** the uninstaller completes. Record retained user data separately; manual file deletion is not a substitute for a successful uninstall.

## 8. Shared core acceptance

Run this set fully on CN, then sample edition-related paths on Global:

1. Search for and open a symbol; verify its name, market, provider and interval.
2. Switch between two intervals. History loads and an old request never overwrites the new chart.
3. During an active market, observe an actual quote or bar change. If no change can be observed, mark realtime not verified instead of substituting static history.
4. Add, remove and reorder watchlist entries, then restart and verify order.
5. Add a built-in indicator and a test `.tfi` indicator, change inputs and verify them after restart.
6. Create a drawing, undo and redo it, and verify restart restoration.
7. When AI is in scope, send one real request and verify actual tool execution rather than generated text alone.
8. Disconnect and restore the network. The UI reports failure and recovers without freezing or showing the wrong symbol.

Provider-specific expectations:

- CN: verify TDX A-share history, quotes and supported adjustment. Realtime needs acceptance during the relevant market session.
- Global: verify the Binance, OKX and Polymarket capabilities intended for the release, and confirm that no TDX code-facing UI is present. Record regional or network restrictions separately.

## 9. Pass criteria and record

Report “Windows acceptance passed” only when:

- both installers came from one candidate commit;
- Windows pre-build checks passed;
- every package installs, starts, restarts and uninstalls;
- edition names and fresh provider defaults are correct;
- Windows-specific and shared-core checks found no blocking regression;
- unverified items, signing status and real-market-session limits are explicit.

Build success, installation success, functional acceptance and publication are four different kinds of evidence.

```text
Candidate commit SHA:
Windows version and architecture:
Node / Rust versions:

Edition: CN / Global
Installer filename:
Installer SHA-256:
Pre-build checks: pass / fail
Install, launch and restart: pass / fail
Edition name and provider defaults: pass / fail / not verified
Language switch and English coverage: pass / fail / not verified
Workspace restore: pass / fail / not verified
OS credentials: pass / fail / not verified
Local and result files: pass / fail / not verified
MCP: pass / fail / not verified
Market history: pass / fail / not verified
Market realtime: pass / fail / not verified
Uninstall: pass / fail
Signing or security prompts:
Reproduction steps and screenshot location:
Other unverified items:
```

For every failure retain the edition, candidate SHA, installer hash, Windows version, steps, expected behavior, actual behavior and complete error. Do not omit a first failure merely because a later retry succeeds.

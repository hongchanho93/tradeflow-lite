# Trusted compiled indicators

[简体中文](README.zh-CN.md)

This directory is for explicitly authorized source-level contributions, compiled with the application. Ordinary users should import isolated [.tfi indicators](../../../docs/en/indicators.md), without submitting files here or obtaining maintainer approval.

Source plugins use `*.indicator.ts` and the existing [Indicator SDK](../../indicator-sdk/contracts.ts). Keep indicator-specific logic out of market providers and the application entry point. Use runtime-managed resources; clean up additional resources. Do not import global styles or use top-level await. Private source plugins can use the sibling `user` directory.

This trusted in-process route must not execute arbitrary imported code. Follow [Source extensions](../../../docs/en/extensions.md) and the relevant SDK/runtime/plugin/UI tests when changing it. There is no implied marketplace, review service or submission guarantee.

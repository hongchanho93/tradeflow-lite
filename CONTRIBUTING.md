# Contributing to TradeFlow Lite

[简体中文](CONTRIBUTING.zh-CN.md)

Thank you for contributing. Keep changes focused, explain the user-visible problem and add tests that fail when the intended behavior breaks. Preserve market identity, time, units, history authority, cancellation and stale-result boundaries described in [AGENTS.md](AGENTS.md).

## License and CLA

Copyright remains with each contributor. Before a non-trivial contribution is merged, the contributor must explicitly accept the [Contributor License Agreement](CLA.md) in a record retained by the maintainers. The CLA gives the maintainers the additional relicensing rights needed to use contributions in other TradeFlow products, including proprietary distributions; it does not transfer the contributor's ownership.

Unless a directory says otherwise, accepted contributions to TradeFlow Lite are distributed under MPL-2.0. Contributions to the separate [`tradeflow-tdx`](https://github.com/hongchanho93/tradeflow-tdx) repository are distributed under `MIT OR Apache-2.0`, at the recipient's option.

## Provenance

Submit only work you created or are authorized to contribute. Identify copied or adapted code, generated assets, datasets and third-party materials in the pull request, including their source and license. Do not submit proprietary source, extracted commercial assets, credentials, private data or material whose redistribution terms are unknown.

## Workflow

1. Open or reference an issue for changes that alter product behavior or public contracts.
2. Keep the pull request limited to one coherent purpose and preserve unrelated work.
3. Update both English and Simplified Chinese public documentation when the behavior is documented in both languages.
4. Run the relevant tests. Documentation changes require `npm run test:docs`; UI changes require `npm run test:ui` and a frontend build; Rust changes require the relevant Cargo tests.
5. State what was tested and what remains unverified. A build is not proof of a signed installer, live market behavior or published release.

By opening a pull request, you do not receive permission to use the TradeFlow Marks beyond the [trademark policy](TRADEMARKS.md).

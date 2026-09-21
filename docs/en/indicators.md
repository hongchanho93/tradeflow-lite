# User indicator reference: .tfi

[简体中文](../zh-CN/indicators.md) · [Home](../../README.md) · [AI tools](api-reference.md)

## Deliver an importable file

A `.tfi` is UTF-8 JavaScript that calls `defineIndicator` exactly once. It runs in an isolated QuickJS/WASM Worker, not the main page. Ordinary users import it through the indicator picker or ask the assistant to install it. No source checkout, build tools or maintainer approval are required to import a compatible file.

Required fields are `formatVersion:1`, `apiVersion:1`, a lowercase namespaced `id`, a positive `indicatorVersion`, `name`, `inputs`, `supports` and `create`. Optional metadata includes `description` and `author`. Names/descriptions may use strings or the supported bilingual text object. For edits, keep the ID, increment the version and preserve the user's parameters and intended rules.

Read `tf_indicator_guide` before generation. For an existing indicator, read `tf_indicator_source`, then use `tf_indicator_validate` → `tf_indicator_test` → `tf_indicator_install`. Validation returns `disposition=new/replace/unchanged`; errors can include `field`, `reason`, `expected`, `failureDetail`, `line` and `column`. Track `sourceHash` and `stage` so diagnostics refer to the candidate actually tested. Release abandoned drafts with `tf_indicator_draft_release`.

Use `applyToExisting=true` for same-ID replacement, then inspect `tf_indicator_instances`; do not add a duplicate after successful migration. A new definition can be added using `tf_indicator_add`. Saving a definition is not proof that an instance is running. Failed updates attempt restoration, but the library is not a permanent version-control system.

## Lifecycle and inputs

`create(context, inputs)` declares resources and returns `{update(event), onPointer?(event)}`. Callbacks are synchronous: no imports/exports, async/await, Promise, timers, network, DOM, filesystem or Tauri API. Normal JavaScript calculations, arrays and closure state are available. Context/inputs/data are read-only; store calculation state in the closure and reset it on instance recreation.

`supports:{seriesKinds:['ohlcv']}` supports OHLCV inputs. Optional `marketKinds` can select `stock`, `etf`, `index` or `crypto`; avoid unnecessary restrictions. Probability series are not currently supported by `.tfi`.

`event.bars` is the full retained, time-ordered OHLCV array for the visible chart timeframe: `time/open/high/low/close/volume`, with optional `amount`. `time` is Unix seconds; `eventTimeMs` uses milliseconds. Keep original bar identities and units. Missing amount is not zero, and the latest bar is not automatically closed.

`event.reason` is `initial`, `history`, `realtime` or `reconciliation`. `changedFrom` is the earliest potentially affected index. Optional `realtimeUpdates` provides `barTime`, `closed`, `closedBy` and `eventTimeMs`. Handle inserted history, corrected bars and rolling retention, not just new bars.

Context contains `instanceId`, `selection={symbol,resolution,adjustment,seriesKind,marketKind,providerId}`, `instrument={priceTick,timeZone,tradingCalendar}`, `theme` and `data`. `priceTick` and `tradingCalendar` may be null when unknown. Theme is `dark` or `light`.

Input types are `number`, `boolean`, `color`, `text`, `select`, all with `title/default`. Number supports `min/max/step`; text supports `maxLength`; select requires `options:[{value,label}]`. Presentation fields include `group/inline/tooltip/activeWhen`. Normalize integer formula inputs explicitly rather than treating `step` as a mathematical guarantee.

## A complete example

The following full-file example is executed by the documentation's indicator regression test. It recomputes the retained window, including historical corrections; initial values without sufficient warm-up remain null.

```tfi
defineIndicator({
  formatVersion: 1,
  apiVersion: 1,
  id: 'user.simple-sma',
  indicatorVersion: 1,
  name: 'Simple moving average',
  inputs: {
    period: { type: 'number', title: 'Period', default: 20, min: 1, max: 500, step: 1 },
  },
  supports: { seriesKinds: ['ohlcv'] },
  create(context, inputs) {
    const line = context.layers.createSeries({
      key: 'sma', type: 'line', pane: 'main',
      options: { color: '#2962ff', lineWidth: 2 },
    });
    const period = Math.max(1, Math.floor(inputs.period));
    return {
      update(event) {
        let sum = 0;
        const values = event.bars.map((bar, index) => {
          sum += bar.close;
          if (index >= period) sum -= event.bars[index - period].close;
          return index + 1 < period ? null : sum / period;
        });
        line.setValues(values, { dirtyFrom: 0 });
      },
    };
  },
});
```

## Multiple timeframes and symbols

Declare host-fetched windows in the top-level `data` field. For example:

```js
data: {
  monthly: { resolution: '1M', count: 8000, adjustment: 'current' },
  benchmark: { symbol: 'SH:000001', kind: 'index', resolution: '1D', count: 500, align: 'main' },
}
```

Read `context.data.get(key)` synchronously. A snapshot includes `symbol/kind/resolution/adjustment/aligned/requestedCount/rowCount/shortfall/coverage/finality/priceUnit/volumeUnit/bars/capturedAtMs`. Failed cross-symbol windows return null; the main indicator can continue. `context.data.status(key)` gives `ready` or `unavailable` with a reason such as `provider_mismatch`, `symbol_unavailable`, `kind_mismatch`, `unsupported_resolution`, `unsupported_adjustment`, `series_kind_unavailable` or `history_unavailable`. An undeclared key has null status.

The current limit is eight windows, including at most four explicitly cross-symbol windows across three distinct target symbols in the current provider. `count` is 2–12000. Resolution values are `1/5/15/30/60/120/240/1D/1W/1M`, subject to provider support; adjustment is `current/none/qfq`. `align=none` retains the source timeline, `main` aligns to the main bars with null gaps, and `main-ffill` forward-fills from earlier source bars but not before the first source bar. Do not confuse timestamp alignment with completed-bar confirmation or use future information.

`event.bars` remains the visible chart timeframe. Use `setData` for a different time axis rather than forcing monthly values into an equally sized daily array. The host performs fetching outside the sandbox without changing the chart. Built-in MA/EMA also expose `sourceResolution` for MTF use.

## Output API

| Resource | Declaration and updates |
| --- | --- |
| Pane | `context.panes.main` gives `{key:'main'}`; `create({key,defaultHeight})` creates a pane, `get(key)` looks it up. Up to four custom panes, height 40–2000. |
| Series | `context.layers.createSeries({key,type,pane,options?})`; `pane` is a key string. Types: line, histogram, area, baseline, bar. |
| Values | `series.setValues(values,{dirtyFrom?})` takes a full-length array of finite numbers/null; `dirtyFrom` is not permission to send only the tail. Non-bar series only. |
| Points | `series.setData(points)` replaces ordered points; `series.update(point)` changes one point; `series.setVisible(boolean)` changes display. |
| Markers | `context.mainSeries.createMarkerContribution({key,priority})`, then `.set(markers)` replaces this indicator's contribution. |
| Candle style | `context.mainSeries.createBarStyleContribution({key,priority,chartKinds})`, then `.set(styles)` changes display, not source prices. |
| Canvas | `context.layers.createCanvasLayer({key,target,zOrder?})`, then `.setCommands(commands)` and `.setVisible(boolean)`. |
| Panel | `context.layers.createPanel({key,paneKey,position})`, then `.set({title?,columns,rows})`. |

Series options are `color/lineWidth/priceLineVisible/lastValueVisible/visible`. Value points use `{time,value?,color?}`; missing value is whitespace. Bar points use `{time,open,high,low,close,color?}`. Colors use hex `#RGB/#RGBA/#RRGGBB/#RRGGBBAA`; native Drawing color support is a separate API.

Markers require `time/position/shape/color`; optional fields are `price/id/text/textColor/tooltip/size/hitTest`. Shapes are `circle/square/arrowUp/arrowDown`. Positions are `aboveBar/belowBar/inBar` or `atPriceTop/atPriceBottom/atPriceMiddle` with a price. Candle styles are ordered `{time,color?,borderColor?,wickColor?}`; `chartKinds` is a nonempty subset of `candles/bars/line/area/baseline`.

Canvas targets are `{type:'current-main-series'}`, `{type:'pane',pane:'key'}` or `{type:'series',series:'key'}`. Coordinates are `time-price` with time/price, `time-pixel` with time/y, or `pane-pixel` with x/y; do not mix coordinate spaces in one geometry. Commands are line(from,to,color), polyline(points,color), polygon(points), rect(from,to), circle(at,radius), text(at,text,color,fontSize). Filled geometry needs `fillColor` or `borderColor`; optional styles include `lineWidth`, dash `solid/dashed/dotted`, and text align `left/center/right`. It is a validated command buffer, not a raw Canvas or DOM handle.

Panels use columns `[{key,title,align?}]` and rows `[{cells:[{text,color?}]}]`. Each row matches the column count; text must be a string, not HTML. Position is `top-left/top-right/middle-left/middle-right/bottom-left/bottom-right`.

## Pointer and order-flow events

Markers and Canvas commands can declare `id` plus `hitTest:true`; interactive Canvas must target `current-main-series`. Implement `onPointer({type,id,time,price,pane})` for `hover/click/leave`. Outputs remain validated. Indicator graphics are clickable/hoverable but **not draggable**; use Drawing for user-editable positions.

Declare `supports.requires.depth:true` and/or `trades:['trade','aggregate-trade']` only when needed. Realtime events may then include `depth`, `trades` and `marketStatus`. Depth is the current snapshot, at most 50 levels per side. Trades are a bounded microbatch of up to 256 entries, with `streamEpoch`, completeness and truncation/drop metadata; do not describe them as a complete historical tape. Market state can be connecting, available, disconnected or degraded.

Live data is marked `source:'live'`. Preflight order-flow fixtures are explicitly `source:'preflight-synthetic'`, not current market data. Historical depth, historical trades and full MBO are not provided. Indicators without `requires` do not receive unnecessary extra order-flow callbacks.

## Test, diagnose and control resource use

`tf_indicator_test` uses the actual retained chart history and one persistent runtime across `initial/history/realtime/reconciliation`. Interactive phases run only when both a hit-test target and `onPointer` exist. Check `coveredReasons`, `coveredPointerTypes`, timings and Series/Marker/BarStyle/Canvas/Panel statistics. An empty `series` array can be valid for a panel-only indicator; check `allOutputsEmpty` instead of assuming failure.

Use `context.log(string)`, not `console.log`: 64 entries and 16 KiB per callback, with 512-character text fields. Catchable errors preserve logs written before the failure and sanitized `failureDetail`; a hard timeout cannot promise recovery of unfinished VM logs. Do not expose credentials or private data in messages.

Current key budgets: source 256 KiB; heap 32 MiB per instance; 16 running instances; eight temporary drafts; four panes, 32 Series, eight Canvas layers and eight Panels. Per callback: 12000 setData points, 2000 markers, 5000 Canvas commands. Panels allow 200 rows and **1000 body cells**, excluding headers. VM execution budgets are initial/reconciliation 2000 ms, history 1000 ms, realtime 100 ms and pointer 100 ms, with separate Worker hard deadlines.

A point limit is not a CPU allowance: avoid rewriting thousands of unchanged points on every tick. Prefer `series.update` and bounded recalculation from the actually affected range. Do not repeatedly restart a failing indicator. Authoritative current limits are in [limits.ts](../../src/user-indicator-runtime/limits.ts); these are engineering protections, not subscription quotas.

More complete resource examples: [pane](../../fixtures/user-indicators/02-range-pane.tfi), [markers](../../fixtures/user-indicators/03-marker-style.tfi), [Canvas](../../fixtures/user-indicators/04-canvas.tfi), [Panel](../../fixtures/user-indicators/05-panel.tfi). For functionality outside the runtime, use a separately authorized [source extension](extensions.md), not an invented `.tfi` API.

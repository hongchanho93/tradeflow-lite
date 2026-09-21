import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSRuntime,
} from 'quickjs-emscripten-core';
import { USER_INDICATOR_RUNTIME_LIMITS, userIndicatorUpdateVmMs } from './limits.ts';
import {
  UserIndicatorOutputError,
  createUserIndicatorOutputValidationState,
  validateUserIndicatorOutputEnvelope,
  type UserIndicatorCallbackOutput,
  type UserIndicatorOutputEnvelope,
  type UserIndicatorOutputExpectation,
  type UserIndicatorOutputValidationState,
} from './output-protocol.ts';
import {
  USER_INDICATOR_EXECUTION_PROTOCOL_VERSION,
  type UserIndicatorExecutionCreateRequest,
  type UserIndicatorExecutionFailure,
  type UserIndicatorExecutionPointerRequest,
  type UserIndicatorExecutionResponse,
  type UserIndicatorExecutionUpdateRequest,
  type UserIndicatorExecutionLog,
} from './supervisor-protocol.ts';
import {
  USER_INDICATOR_API_VERSION,
  USER_INDICATOR_FORMAT_VERSION,
} from './user-definition.ts';

let quickJsPromise: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;

function getQuickJs() {
  quickJsPromise ??= newQuickJSWASMModuleFromVariant(variant);
  return quickJsPromise;
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object' && 'message' in value) {
    return String((value as { message?: unknown }).message ?? value);
  }
  return String(value);
}

function classifyRuntimeError(value: unknown): { code: string; message: string } {
  const message = errorMessage(value);
  if (/TRADEFLOW_OUTPUT_LIMIT/i.test(message)) {
    return { code: 'output_limit_exceeded', message };
  }
  if (/TRADEFLOW_INVALID_OUTPUT/i.test(message)) {
    return { code: 'invalid_output', message };
  }
  if (/TRADEFLOW_ASYNC_NOT_SUPPORTED/i.test(message)) {
    return { code: 'async_not_supported', message: 'user indicator callbacks must be synchronous' };
  }
  if (/interrupted/i.test(message)) return { code: 'execution_timeout', message };
  if (/out of memory/i.test(message)) return { code: 'memory_limit_exceeded', message };
  if (/stack overflow|maximum call stack size exceeded/i.test(message)) {
    return { code: 'stack_limit_exceeded', message };
  }
  return { code: 'runtime_exception', message };
}

function encodePayload(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('user indicator runtime payload must be JSON serializable');
  return JSON.stringify(encoded);
}

function createBridgeSecret(): string {
  const cryptoValue = globalThis.crypto;
  if (!cryptoValue?.getRandomValues) throw new Error('secure random source unavailable for user indicator runtime');
  const words = new Uint32Array(4);
  cryptoValue.getRandomValues(words);
  return [...words].map((word) => word.toString(16).padStart(8, '0')).join('');
}

function runtimeBootstrap(secret: string): string {
  return String.raw`
(() => {
  'use strict';
  const BRIDGE_SECRET = ${JSON.stringify(secret)};
  const SafeError = Error;
  const safeApply = Reflect.apply;
  const safeDefineProperty = Object.defineProperty;
  const safeCreate = Object.create;
  const safeFreeze = Object.freeze;
  const safeKeys = Object.keys;
  const safeHasOwn = Object.prototype.hasOwnProperty;
  const safeParse = JSON.parse;
  const safeStringify = JSON.stringify;
  const safeIsArray = Array.isArray;
  const safeIsInteger = Number.isInteger;
  const safeIsFinite = Number.isFinite;
  const safeRegExpTest = RegExp.prototype.test;
  const safeCharCodeAt = String.prototype.charCodeAt;
  const safeSlice = String.prototype.slice;
  const SafeArray = Array;

  const MAX_RESOURCE_KEY_CHARS = ${USER_INDICATOR_RUNTIME_LIMITS.resourceKeyChars};
  const MIN_PANE_HEIGHT = ${USER_INDICATOR_RUNTIME_LIMITS.paneMinHeight};
  const MAX_PANE_HEIGHT = ${USER_INDICATOR_RUNTIME_LIMITS.paneMaxHeight};
  const MAX_PANES = ${USER_INDICATOR_RUNTIME_LIMITS.panes};
  const MAX_SERIES = ${USER_INDICATOR_RUNTIME_LIMITS.series};
  const MAX_SERIES_DATA_POINTS = ${USER_INDICATOR_RUNTIME_LIMITS.seriesDataPointsPerCallback};
  const MAX_LINE_WIDTH = ${USER_INDICATOR_RUNTIME_LIMITS.seriesLineWidthMax};
  const MAX_COMMANDS = ${USER_INDICATOR_RUNTIME_LIMITS.outboxCommandsPerCallback};
  const MAX_MARKERS = ${USER_INDICATOR_RUNTIME_LIMITS.markersPerCallback};
  const MAX_CANVAS_LAYERS = ${USER_INDICATOR_RUNTIME_LIMITS.canvasLayers};
  const MAX_CANVAS_COMMANDS = ${USER_INDICATOR_RUNTIME_LIMITS.canvasCommandsPerCallback};
  const MAX_CANVAS_POINTS = ${USER_INDICATOR_RUNTIME_LIMITS.canvasPointsPerCommand};
  const MAX_CANVAS_LINE_WIDTH = ${USER_INDICATOR_RUNTIME_LIMITS.canvasLineWidthMax};
  const MIN_CANVAS_FONT_SIZE = ${USER_INDICATOR_RUNTIME_LIMITS.canvasFontSizeMin};
  const MAX_CANVAS_FONT_SIZE = ${USER_INDICATOR_RUNTIME_LIMITS.canvasFontSizeMax};
  const MAX_CANVAS_PIXEL_MAGNITUDE = ${USER_INDICATOR_RUNTIME_LIMITS.canvasPixelMagnitudeMax};
  const MAX_CANVAS_RADIUS = ${USER_INDICATOR_RUNTIME_LIMITS.canvasRadiusMax};
  const MAX_PANELS = ${USER_INDICATOR_RUNTIME_LIMITS.panels};
  const MAX_PANEL_ROWS = ${USER_INDICATOR_RUNTIME_LIMITS.panelRows};
  const MAX_PANEL_CELLS = ${USER_INDICATOR_RUNTIME_LIMITS.panelCells};
  const MAX_TEXT_FIELD_CHARS = ${USER_INDICATOR_RUNTIME_LIMITS.textFieldChars};
  const MAX_CALLBACK_TEXT_BYTES = ${USER_INDICATOR_RUNTIME_LIMITS.callbackTextBytes};
  const MAX_LOG_ENTRIES = ${USER_INDICATOR_RUNTIME_LIMITS.consoleEntriesPerCallback};
  const MAX_LOG_BYTES = ${USER_INDICATOR_RUNTIME_LIMITS.consoleBytesPerCallback};
  const BULK_OUTPUT_BYTES = ${USER_INDICATOR_RUNTIME_LIMITS.bulkOutputBytes};
  const REALTIME_OUTPUT_BYTES = ${USER_INDICATOR_RUNTIME_LIMITS.realtimeOutputBytes};
  const RESOURCE_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
  const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const SERIES_TYPES = safeFreeze(['line', 'histogram', 'area', 'baseline', 'bar']);
  const MARKER_BAR_POSITIONS = safeFreeze(['aboveBar', 'belowBar', 'inBar']);
  const MARKER_PRICE_POSITIONS = safeFreeze(['atPriceTop', 'atPriceBottom', 'atPriceMiddle']);
  const MARKER_SHAPES = safeFreeze(['circle', 'square', 'arrowUp', 'arrowDown']);
  const BAR_STYLE_CHART_KINDS = safeFreeze(['candles', 'bars', 'line', 'area', 'baseline']);
  const CANVAS_Z_ORDERS = safeFreeze(['bottom', 'normal', 'top']);
  const CANVAS_DASHES = safeFreeze(['solid', 'dashed', 'dotted']);
  const CANVAS_TEXT_ALIGNS = safeFreeze(['left', 'center', 'right']);
  const PANEL_POSITIONS = safeFreeze(['top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-right']);
  const PANEL_ALIGNS = safeFreeze(['left', 'center', 'right']);
  const RESERVED_KEYS = safeFreeze(['__proto__', 'prototype', 'constructor']);

  let definitionCount = 0;
  let formatVersion;
  let apiVersion;
  let createCallback = null;
  let lifecycle = null;
  let updateCallback = null;
  let pointerCallback = null;
  let bars = safeFreeze([]);
  let currentPhase = null;
  let currentEventMeta = null;
  let outbox = null;
  let callbackMarkerCount = 0;
  let callbackCanvasCommandCount = 0;
  let callbackTextBytes = 0;
  let callbackLogCount = 0;
  let callbackLogBytes = 0;
  let paneCount = 0;
  let seriesCount = 0;
  const paneHandles = safeCreate(null);
  const seriesResources = safeCreate(null);
  const markerResources = safeCreate(null);
  const barStyleResources = safeCreate(null);
  const canvasResources = safeCreate(null);
  const panelResources = safeCreate(null);
  let canvasLayerCount = 0;
  let panelCount = 0;

  const fail = (message) => { throw new SafeError(message); };
  const invalidOutput = (message) => fail('TRADEFLOW_INVALID_OUTPUT: ' + message);
  const outputLimit = (message) => fail('TRADEFLOW_OUTPUT_LIMIT: ' + message);
  const hasOwn = (object, key) => safeApply(safeHasOwn, object, [key]);
  const regexTest = (pattern, value) => safeApply(safeRegExpTest, pattern, [value]);
  const charCodeAt = (value, index) => safeApply(safeCharCodeAt, value, [index]);

  const utf8ByteLength = (value) => {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
      const code = charCodeAt(value, index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
        const next = charCodeAt(value, index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          index += 1;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }
    return bytes;
  };

  const assertFinite = (value, field) => {
    if (typeof value !== 'number' || !safeIsFinite(value)) invalidOutput(field + ' must be finite');
    return value;
  };

  const assertInteger = (value, field) => {
    assertFinite(value, field);
    if (!safeIsInteger(value)) invalidOutput(field + ' must be an integer');
    return value;
  };

  const assertResourceKey = (value, field) => {
    if (
      typeof value !== 'string'
      || value.length === 0
      || value.length > MAX_RESOURCE_KEY_CHARS
      || !regexTest(RESOURCE_KEY_PATTERN, value)
    ) invalidOutput(field + ' is not a valid resource key');
    for (let index = 0; index < RESERVED_KEYS.length; index += 1) {
      if (value === RESERVED_KEYS[index]) invalidOutput(field + ' is reserved');
    }
    return value;
  };

  const assertColor = (value, field) => {
    if (typeof value !== 'string' || !regexTest(HEX_COLOR_PATTERN, value)) {
      invalidOutput(field + ' must be a hexadecimal color');
    }
    return value;
  };

  const assertTextField = (value, field) => {
    if (typeof value !== 'string') invalidOutput(field + ' must be a string');
    if (value.length > MAX_TEXT_FIELD_CHARS) outputLimit(field + ' exceeds ' + MAX_TEXT_FIELD_CHARS + ' characters');
    callbackTextBytes += utf8ByteLength(value);
    if (callbackTextBytes > MAX_CALLBACK_TEXT_BYTES) {
      outputLimit('callback text exceeds ' + MAX_CALLBACK_TEXT_BYTES + ' bytes');
    }
    return value;
  };

  const assertPlainObject = (value, field) => {
    if (!value || typeof value !== 'object' || safeIsArray(value)) invalidOutput(field + ' must be an object');
    return value;
  };

  const assertAllowedKeys = (value, allowed, field) => {
    const keys = safeKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      let accepted = false;
      for (let allowedIndex = 0; allowedIndex < allowed.length; allowedIndex += 1) {
        if (keys[index] === allowed[allowedIndex]) { accepted = true; break; }
      }
      if (!accepted) invalidOutput(field + ' contains unsupported field ' + keys[index]);
    }
  };

  const beginCallback = (phase, eventMeta) => {
    currentPhase = phase;
    currentEventMeta = eventMeta;
    outbox = new SafeArray();
    callbackMarkerCount = 0;
    callbackCanvasCommandCount = 0;
    callbackTextBytes = 0;
    callbackLogCount = 0;
    callbackLogBytes = 0;
  };

  const pushCommand = (command) => {
    if (outbox === null) invalidOutput('indicator output is only allowed inside create/update/onPointer callbacks');
    if (outbox.length >= MAX_COMMANDS) outputLimit('callback command limit ' + MAX_COMMANDS + ' exceeded');
    outbox[outbox.length] = safeFreeze(command);
  };

  const debugLog = (message) => {
    if (currentPhase !== 'create' && currentPhase !== 'update' && currentPhase !== 'pointer') {
      invalidOutput('context.log is only allowed inside create/update/onPointer callbacks');
    }
    callbackLogCount += 1;
    if (callbackLogCount > MAX_LOG_ENTRIES) outputLimit('context.log entry limit ' + MAX_LOG_ENTRIES + ' exceeded');
    const copied = assertTextField(message, 'context.log message');
    callbackLogBytes += utf8ByteLength(copied);
    if (callbackLogBytes > MAX_LOG_BYTES) outputLimit('context.log byte limit ' + MAX_LOG_BYTES + ' exceeded');
    pushCommand({ type: 'debug-log', message: copied });
  };

  const callbackFailureMessage = (error) => {
    let message = 'user indicator callback failed';
    try {
      if (typeof error === 'string') message = error;
      else if (error && typeof error === 'object' && typeof error.message === 'string') message = error.message;
    } catch {}
    return safeApply(safeSlice, message, [0, MAX_TEXT_FIELD_CHARS]);
  };

  const finishFailedCallback = (error) => {
    const logs = new SafeArray();
    if (outbox !== null) {
      for (let index = 0; index < outbox.length; index += 1) {
        const command = outbox[index];
        if (command && command.type === 'debug-log' && typeof command.message === 'string') {
          logs[logs.length] = safeFreeze({ phase: currentPhase, message: command.message });
        }
      }
    }
    const failure = safeFreeze({
      __tradeflowCallbackFailure: 1,
      phase: currentPhase,
      message: callbackFailureMessage(error),
      logs: safeFreeze(logs),
    });
    currentPhase = null;
    currentEventMeta = null;
    outbox = null;
    return safeStringify(failure);
  };

  const finishCallback = () => {
    const commands = safeFreeze(outbox === null ? new SafeArray() : outbox);
    const callback = currentPhase === 'create'
      ? safeFreeze({ phase: 'create', commands })
      : currentPhase === 'pointer'
        ? safeFreeze({
            phase: 'pointer',
            pointerType: currentEventMeta.type,
            id: currentEventMeta.id,
            time: currentEventMeta.time,
            price: currentEventMeta.price,
            pane: currentEventMeta.pane,
            commands,
          })
        : safeFreeze({
          phase: 'update',
          reason: currentEventMeta.reason,
          changedFrom: currentEventMeta.changedFrom,
          barsLength: bars.length,
          commands,
        });
    const serialized = safeStringify(callback);
    const maxBytes = currentPhase === 'pointer' || (currentPhase === 'update' && currentEventMeta.reason === 'realtime')
      ? REALTIME_OUTPUT_BYTES
      : BULK_OUTPUT_BYTES;
    if (utf8ByteLength(serialized) > maxBytes) outputLimit('serialized callback output exceeds ' + maxBytes + ' bytes');
    currentPhase = null;
    currentEventMeta = null;
    outbox = null;
    return serialized;
  };

  const requireCreatePhase = (operation) => {
    if (currentPhase !== 'create') invalidOutput(operation + ' is only allowed during create()');
  };

  const requireUpdatePhase = (operation) => {
    if ((currentPhase !== 'update' && currentPhase !== 'pointer') || currentEventMeta === null) {
      invalidOutput(operation + ' is only allowed during update()/onPointer()');
    }
  };

  const validateSeriesOptions = (value) => {
    if (value === undefined) return undefined;
    const options = assertPlainObject(value, 'series options');
    assertAllowedKeys(options, ['color', 'lineWidth', 'priceLineVisible', 'lastValueVisible', 'visible'], 'series options');
    const copied = safeCreate(null);
    if (options.color !== undefined) copied.color = assertColor(options.color, 'series options.color');
    if (options.lineWidth !== undefined) {
      const width = assertInteger(options.lineWidth, 'series options.lineWidth');
      if (width < 1 || width > MAX_LINE_WIDTH) invalidOutput('series options.lineWidth is outside the supported range');
      copied.lineWidth = width;
    }
    const booleanKeys = ['priceLineVisible', 'lastValueVisible', 'visible'];
    for (let index = 0; index < booleanKeys.length; index += 1) {
      const key = booleanKeys[index];
      if (options[key] !== undefined) {
        if (typeof options[key] !== 'boolean') invalidOutput('series options.' + key + ' must be boolean');
        copied[key] = options[key];
      }
    }
    return safeFreeze(copied);
  };

  const validatePoint = (value, seriesType, field) => {
    const point = assertPlainObject(value, field);
    if (seriesType === 'bar') {
      assertAllowedKeys(point, ['time', 'open', 'high', 'low', 'close', 'color'], field);
      const copied = {
        time: assertInteger(point.time, field + '.time'),
        open: assertFinite(point.open, field + '.open'),
        high: assertFinite(point.high, field + '.high'),
        low: assertFinite(point.low, field + '.low'),
        close: assertFinite(point.close, field + '.close'),
      };
      if (point.color !== undefined) copied.color = assertColor(point.color, field + '.color');
      return safeFreeze(copied);
    }
    assertAllowedKeys(point, ['time', 'value', 'color'], field);
    const copied = { time: assertInteger(point.time, field + '.time') };
    if (point.value !== undefined) copied.value = assertFinite(point.value, field + '.value');
    if (point.color !== undefined) copied.color = assertColor(point.color, field + '.color');
    return safeFreeze(copied);
  };

  const includesValue = (values, candidate) => {
    for (let index = 0; index < values.length; index += 1) {
      if (candidate === values[index]) return true;
    }
    return false;
  };

  const validateMarker = (value, field) => {
    const marker = assertPlainObject(value, field);
    assertAllowedKeys(
      marker,
      ['time', 'position', 'shape', 'color', 'price', 'id', 'text', 'textColor', 'tooltip', 'size', 'hitTest'],
      field,
    );
    const position = marker.position;
    if (typeof position !== 'string'
      || (!includesValue(MARKER_BAR_POSITIONS, position) && !includesValue(MARKER_PRICE_POSITIONS, position))) {
      invalidOutput(field + '.position is unsupported');
    }
    if (typeof marker.shape !== 'string' || !includesValue(MARKER_SHAPES, marker.shape)) {
      invalidOutput(field + '.shape is unsupported');
    }
    let price;
    if (marker.price !== undefined) price = assertFinite(marker.price, field + '.price');
    if (includesValue(MARKER_PRICE_POSITIONS, position) && price === undefined) {
      invalidOutput(field + '.price is required for ' + position);
    }
    let size;
    if (marker.size !== undefined) {
      size = assertFinite(marker.size, field + '.size');
      if (size <= 0) invalidOutput(field + '.size must be positive');
    }
    if (marker.hitTest !== undefined && typeof marker.hitTest !== 'boolean') invalidOutput(field + '.hitTest must be boolean');
    if (marker.hitTest === true && marker.id === undefined) invalidOutput(field + '.id is required when hitTest=true');
    const copied = {
      time: assertInteger(marker.time, field + '.time'),
      position,
      shape: marker.shape,
      color: assertColor(marker.color, field + '.color'),
    };
    if (price !== undefined) copied.price = price;
    if (marker.id !== undefined) copied.id = assertTextField(marker.id, field + '.id');
    if (marker.text !== undefined) copied.text = assertTextField(marker.text, field + '.text');
    if (marker.textColor !== undefined) copied.textColor = assertColor(marker.textColor, field + '.textColor');
    if (marker.tooltip !== undefined) copied.tooltip = assertTextField(marker.tooltip, field + '.tooltip');
    if (size !== undefined) copied.size = size;
    if (marker.hitTest !== undefined) copied.hitTest = marker.hitTest;
    return safeFreeze(copied);
  };

  const validateBarStyleChartKinds = (value, field) => {
    if (!safeIsArray(value) || value.length === 0 || value.length > BAR_STYLE_CHART_KINDS.length) {
      invalidOutput(field + ' must be a non-empty chart kind array');
    }
    const copied = new SafeArray(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const chartKind = value[index];
      if (typeof chartKind !== 'string' || !includesValue(BAR_STYLE_CHART_KINDS, chartKind)) {
        invalidOutput(field + '[' + index + '] is unsupported');
      }
      for (let previous = 0; previous < index; previous += 1) {
        if (copied[previous] === chartKind) invalidOutput(field + ' contains duplicate chart kind ' + chartKind);
      }
      copied[index] = chartKind;
    }
    return safeFreeze(copied);
  };

  const validateBarStyle = (value, field) => {
    const style = assertPlainObject(value, field);
    assertAllowedKeys(style, ['time', 'color', 'borderColor', 'wickColor'], field);
    const copied = { time: assertInteger(style.time, field + '.time') };
    if (style.color !== undefined) copied.color = assertColor(style.color, field + '.color');
    if (style.borderColor !== undefined) copied.borderColor = assertColor(style.borderColor, field + '.borderColor');
    if (style.wickColor !== undefined) copied.wickColor = assertColor(style.wickColor, field + '.wickColor');
    return safeFreeze(copied);
  };

  const assertCanvasPixel = (value, field) => {
    const pixel = assertFinite(value, field);
    if (pixel < -MAX_CANVAS_PIXEL_MAGNITUDE || pixel > MAX_CANVAS_PIXEL_MAGNITUDE) {
      invalidOutput(field + ' exceeds the supported pixel magnitude');
    }
    return pixel;
  };

  const assertCanvasLineWidth = (value, field) => {
    const width = assertFinite(value, field);
    if (width <= 0 || width > MAX_CANVAS_LINE_WIDTH) invalidOutput(field + ' is outside the supported range');
    return width;
  };

  const validateCanvasPoint = (value, field, allowPrice) => {
    const point = assertPlainObject(value, field);
    if (point.space === 'time-price') {
      assertAllowedKeys(point, ['space', 'time', 'price'], field);
      if (!allowPrice) invalidOutput(field + ' cannot use time-price coordinates on a pane canvas target');
      return safeFreeze({
        space: 'time-price',
        time: assertInteger(point.time, field + '.time'),
        price: assertFinite(point.price, field + '.price'),
      });
    }
    if (point.space === 'time-pixel') {
      assertAllowedKeys(point, ['space', 'time', 'y'], field);
      return safeFreeze({
        space: 'time-pixel',
        time: assertInteger(point.time, field + '.time'),
        y: assertCanvasPixel(point.y, field + '.y'),
      });
    }
    if (point.space === 'pane-pixel') {
      assertAllowedKeys(point, ['space', 'x', 'y'], field);
      return safeFreeze({
        space: 'pane-pixel',
        x: assertCanvasPixel(point.x, field + '.x'),
        y: assertCanvasPixel(point.y, field + '.y'),
      });
    }
    invalidOutput(field + '.space is unsupported');
  };

  const validateCanvasTarget = (value, field) => {
    const target = assertPlainObject(value, field);
    if (target.type === 'current-main-series') {
      assertAllowedKeys(target, ['type'], field);
      return safeFreeze({ type: 'current-main-series' });
    }
    if (target.type === 'pane') {
      assertAllowedKeys(target, ['type', 'pane'], field);
      if (typeof target.pane !== 'string' || !hasOwn(paneHandles, target.pane)) invalidOutput(field + '.pane does not exist');
      return safeFreeze({ type: 'pane', pane: target.pane });
    }
    if (target.type === 'series') {
      assertAllowedKeys(target, ['type', 'series'], field);
      if (typeof target.series !== 'string' || !hasOwn(seriesResources, target.series)) invalidOutput(field + '.series does not exist');
      return safeFreeze({ type: 'series', series: target.series });
    }
    invalidOutput(field + '.type is unsupported');
  };

  const validateCanvasDash = (value, field) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !includesValue(CANVAS_DASHES, value)) invalidOutput(field + ' is unsupported');
    return value;
  };

  const assertOneCanvasSpace = (points, field) => {
    if (points.length === 0) return;
    const space = points[0].space;
    for (let index = 1; index < points.length; index += 1) {
      if (points[index].space !== space) invalidOutput(field + ' must use one coordinate space per command');
    }
  };

  const validateCanvasCommands = (commands, resource, field) => {
    if (!safeIsArray(commands)) invalidOutput(field + ' must be an array');
    callbackCanvasCommandCount += commands.length;
    if (callbackCanvasCommandCount > MAX_CANVAS_COMMANDS) outputLimit('callback canvas command limit ' + MAX_CANVAS_COMMANDS + ' exceeded');
    const allowPrice = resource.target.type !== 'pane';
    const copied = new SafeArray(commands.length);
    for (let index = 0; index < commands.length; index += 1) {
      const commandField = field + '[' + index + ']';
      const command = assertPlainObject(commands[index], commandField);
      if (typeof command.type !== 'string') invalidOutput(commandField + '.type must be a string');

      const interaction = (allowed) => {
        const fields = new SafeArray(allowed.length + 2);
        for (let item = 0; item < allowed.length; item += 1) fields[item] = allowed[item];
        fields[allowed.length] = 'id';
        fields[allowed.length + 1] = 'hitTest';
        assertAllowedKeys(command, fields, commandField);
        if (command.hitTest !== undefined && typeof command.hitTest !== 'boolean') invalidOutput(commandField + '.hitTest must be boolean');
        if (command.hitTest === true && command.id === undefined) invalidOutput(commandField + '.id is required when hitTest=true');
        if (command.hitTest === true && resource.target.type !== 'current-main-series') {
          invalidOutput(commandField + '.hitTest is currently supported only on current-main-series canvas layers');
        }
        const result = {};
        if (command.id !== undefined) result.id = assertTextField(command.id, commandField + '.id');
        if (command.hitTest !== undefined) result.hitTest = command.hitTest;
        return result;
      };

      if (command.type === 'line') {
        const interactive = interaction(['type', 'from', 'to', 'color', 'lineWidth', 'dash']);
        const from = validateCanvasPoint(command.from, commandField + '.from', allowPrice);
        const to = validateCanvasPoint(command.to, commandField + '.to', allowPrice);
        assertOneCanvasSpace([from, to], commandField);
        const result = {
          type: 'line', from, to, color: assertColor(command.color, commandField + '.color'),
        };
        if (interactive.id !== undefined) result.id = interactive.id;
        if (interactive.hitTest !== undefined) result.hitTest = interactive.hitTest;
        if (command.lineWidth !== undefined) result.lineWidth = assertCanvasLineWidth(command.lineWidth, commandField + '.lineWidth');
        if (command.dash !== undefined) result.dash = validateCanvasDash(command.dash, commandField + '.dash');
        copied[index] = safeFreeze(result);
        continue;
      }

      if (command.type === 'polyline' || command.type === 'polygon') {
        const polygon = command.type === 'polygon';
        const interactive = interaction(polygon
          ? ['type', 'points', 'fillColor', 'borderColor', 'lineWidth', 'dash']
          : ['type', 'points', 'color', 'lineWidth', 'dash']);
        if (!safeIsArray(command.points)) invalidOutput(commandField + '.points must be an array');
        const minimum = polygon ? 3 : 2;
        if (command.points.length < minimum) invalidOutput(commandField + '.points has too few points');
        if (command.points.length > MAX_CANVAS_POINTS) outputLimit(commandField + '.points exceeds ' + MAX_CANVAS_POINTS);
        const points = new SafeArray(command.points.length);
        for (let pointIndex = 0; pointIndex < command.points.length; pointIndex += 1) {
          points[pointIndex] = validateCanvasPoint(command.points[pointIndex], commandField + '.points[' + pointIndex + ']', allowPrice);
        }
        assertOneCanvasSpace(points, commandField + '.points');
        const result = { type: command.type, points: safeFreeze(points) };
        if (interactive.id !== undefined) result.id = interactive.id;
        if (interactive.hitTest !== undefined) result.hitTest = interactive.hitTest;
        if (polygon) {
          if (command.fillColor === undefined && command.borderColor === undefined) invalidOutput(commandField + ' requires fillColor or borderColor');
          if (command.fillColor !== undefined) result.fillColor = assertColor(command.fillColor, commandField + '.fillColor');
          if (command.borderColor !== undefined) result.borderColor = assertColor(command.borderColor, commandField + '.borderColor');
        } else {
          result.color = assertColor(command.color, commandField + '.color');
        }
        if (command.lineWidth !== undefined) result.lineWidth = assertCanvasLineWidth(command.lineWidth, commandField + '.lineWidth');
        if (command.dash !== undefined) result.dash = validateCanvasDash(command.dash, commandField + '.dash');
        copied[index] = safeFreeze(result);
        continue;
      }

      if (command.type === 'rect') {
        const interactive = interaction(['type', 'from', 'to', 'fillColor', 'borderColor', 'lineWidth', 'dash']);
        if (command.fillColor === undefined && command.borderColor === undefined) invalidOutput(commandField + ' requires fillColor or borderColor');
        const from = validateCanvasPoint(command.from, commandField + '.from', allowPrice);
        const to = validateCanvasPoint(command.to, commandField + '.to', allowPrice);
        assertOneCanvasSpace([from, to], commandField);
        const result = { type: 'rect', from, to };
        if (interactive.id !== undefined) result.id = interactive.id;
        if (interactive.hitTest !== undefined) result.hitTest = interactive.hitTest;
        if (command.fillColor !== undefined) result.fillColor = assertColor(command.fillColor, commandField + '.fillColor');
        if (command.borderColor !== undefined) result.borderColor = assertColor(command.borderColor, commandField + '.borderColor');
        if (command.lineWidth !== undefined) result.lineWidth = assertCanvasLineWidth(command.lineWidth, commandField + '.lineWidth');
        if (command.dash !== undefined) result.dash = validateCanvasDash(command.dash, commandField + '.dash');
        copied[index] = safeFreeze(result);
        continue;
      }

      if (command.type === 'circle') {
        const interactive = interaction(['type', 'at', 'radius', 'fillColor', 'borderColor', 'lineWidth', 'dash']);
        if (command.fillColor === undefined && command.borderColor === undefined) invalidOutput(commandField + ' requires fillColor or borderColor');
        const radius = assertFinite(command.radius, commandField + '.radius');
        if (radius <= 0 || radius > MAX_CANVAS_RADIUS) invalidOutput(commandField + '.radius is outside the supported range');
        const result = { type: 'circle', at: validateCanvasPoint(command.at, commandField + '.at', allowPrice), radius };
        if (interactive.id !== undefined) result.id = interactive.id;
        if (interactive.hitTest !== undefined) result.hitTest = interactive.hitTest;
        if (command.fillColor !== undefined) result.fillColor = assertColor(command.fillColor, commandField + '.fillColor');
        if (command.borderColor !== undefined) result.borderColor = assertColor(command.borderColor, commandField + '.borderColor');
        if (command.lineWidth !== undefined) result.lineWidth = assertCanvasLineWidth(command.lineWidth, commandField + '.lineWidth');
        if (command.dash !== undefined) result.dash = validateCanvasDash(command.dash, commandField + '.dash');
        copied[index] = safeFreeze(result);
        continue;
      }

      if (command.type === 'text') {
        const interactive = interaction(['type', 'at', 'text', 'color', 'fontSize', 'align']);
        const fontSize = assertFinite(command.fontSize, commandField + '.fontSize');
        if (fontSize < MIN_CANVAS_FONT_SIZE || fontSize > MAX_CANVAS_FONT_SIZE) invalidOutput(commandField + '.fontSize is outside the supported range');
        const result = {
          type: 'text',
          at: validateCanvasPoint(command.at, commandField + '.at', allowPrice),
          text: assertTextField(command.text, commandField + '.text'),
          color: assertColor(command.color, commandField + '.color'),
          fontSize,
        };
        if (interactive.id !== undefined) result.id = interactive.id;
        if (interactive.hitTest !== undefined) result.hitTest = interactive.hitTest;
        if (command.align !== undefined) {
          if (typeof command.align !== 'string' || !includesValue(CANVAS_TEXT_ALIGNS, command.align)) invalidOutput(commandField + '.align is unsupported');
          result.align = command.align;
        }
        copied[index] = safeFreeze(result);
        continue;
      }

      invalidOutput(commandField + '.type is unsupported');
    }
    return safeFreeze(copied);
  };

  const validatePanelContent = (value, field) => {
    const panel = assertPlainObject(value, field);
    assertAllowedKeys(panel, ['title', 'columns', 'rows'], field);
    if (!safeIsArray(panel.columns) || panel.columns.length === 0) invalidOutput(field + '.columns must be a non-empty array');
    if (!safeIsArray(panel.rows)) invalidOutput(field + '.rows must be an array');
    if (panel.rows.length > MAX_PANEL_ROWS) outputLimit(field + '.rows exceeds ' + MAX_PANEL_ROWS);

    const seenColumns = safeCreate(null);
    const columns = new SafeArray(panel.columns.length);
    for (let index = 0; index < panel.columns.length; index += 1) {
      const columnField = field + '.columns[' + index + ']';
      const column = assertPlainObject(panel.columns[index], columnField);
      assertAllowedKeys(column, ['key', 'title', 'align'], columnField);
      const key = assertResourceKey(column.key, columnField + '.key');
      if (hasOwn(seenColumns, key)) invalidOutput(field + '.columns contains duplicate key ' + key);
      seenColumns[key] = true;
      const copied = {
        key,
        title: assertTextField(column.title, columnField + '.title'),
      };
      if (column.align !== undefined) {
        if (typeof column.align !== 'string' || !includesValue(PANEL_ALIGNS, column.align)) {
          invalidOutput(columnField + '.align is unsupported');
        }
        copied.align = column.align;
      }
      columns[index] = safeFreeze(copied);
    }

    let cellCount = 0;
    const rows = new SafeArray(panel.rows.length);
    for (let rowIndex = 0; rowIndex < panel.rows.length; rowIndex += 1) {
      const rowField = field + '.rows[' + rowIndex + ']';
      const row = assertPlainObject(panel.rows[rowIndex], rowField);
      assertAllowedKeys(row, ['cells'], rowField);
      if (!safeIsArray(row.cells) || row.cells.length !== columns.length) {
        invalidOutput(rowField + '.cells must contain exactly ' + columns.length + ' entries');
      }
      cellCount += row.cells.length;
      if (cellCount > MAX_PANEL_CELLS) outputLimit(field + ' exceeds ' + MAX_PANEL_CELLS + ' table cells');
      const cells = new SafeArray(row.cells.length);
      for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
        const cellField = rowField + '.cells[' + cellIndex + ']';
        const cell = assertPlainObject(row.cells[cellIndex], cellField);
        assertAllowedKeys(cell, ['text', 'color'], cellField);
        const copied = { text: assertTextField(cell.text, cellField + '.text') };
        if (cell.color !== undefined) copied.color = assertColor(cell.color, cellField + '.color');
        cells[cellIndex] = safeFreeze(copied);
      }
      rows[rowIndex] = safeFreeze({ cells: safeFreeze(cells) });
    }

    const copied = { columns: safeFreeze(columns), rows: safeFreeze(rows) };
    if (panel.title !== undefined) copied.title = assertTextField(panel.title, field + '.title');
    return safeFreeze(copied);
  };

  const createSeriesHandle = (resource) => safeFreeze({
    key: resource.key,
    type: resource.seriesType,
    pane: resource.pane,
    setValues(values, options) {
      requireUpdatePhase('series.setValues');
      if (resource.seriesType === 'bar') invalidOutput('series.setValues is not supported for bar series');
      if (!safeIsArray(values) || values.length !== bars.length) {
        invalidOutput('series.setValues values must match current bars length');
      }
      const copied = new SafeArray(values.length);
      for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        copied[index] = value === null ? null : assertFinite(value, 'series.setValues values[' + index + ']');
      }
      let dirtyFrom;
      if (options !== undefined) {
        const normalized = assertPlainObject(options, 'series.setValues options');
        assertAllowedKeys(normalized, ['dirtyFrom'], 'series.setValues options');
        if (normalized.dirtyFrom !== undefined) {
          dirtyFrom = assertInteger(normalized.dirtyFrom, 'series.setValues options.dirtyFrom');
          if (dirtyFrom < 0 || dirtyFrom > bars.length) invalidOutput('series.setValues dirtyFrom is outside bars range');
        }
      }
      pushCommand({
        type: 'series-set-values',
        key: resource.key,
        values: safeFreeze(copied),
        ...(dirtyFrom === undefined ? {} : { dirtyFrom }),
      });
    },
    setData(points) {
      requireUpdatePhase('series.setData');
      if (!safeIsArray(points)) invalidOutput('series.setData points must be an array');
      if (points.length > MAX_SERIES_DATA_POINTS) outputLimit('series.setData points exceeds ' + MAX_SERIES_DATA_POINTS);
      const copied = new SafeArray(points.length);
      let previousTime = -Infinity;
      for (let index = 0; index < points.length; index += 1) {
        const point = validatePoint(points[index], resource.seriesType, 'series.setData points[' + index + ']');
        if (point.time <= previousTime) invalidOutput('series.setData points must be strictly increasing by time');
        previousTime = point.time;
        copied[index] = point;
      }
      pushCommand({ type: 'series-set-data', key: resource.key, points: safeFreeze(copied) });
    },
    update(point) {
      requireUpdatePhase('series.update');
      pushCommand({ type: 'series-update', key: resource.key, point: validatePoint(point, resource.seriesType, 'series.update point') });
    },
    setVisible(visible) {
      if (currentPhase !== 'create' && currentPhase !== 'update') invalidOutput('series.setVisible is only allowed inside create/update callbacks');
      if (typeof visible !== 'boolean') invalidOutput('series.setVisible visible must be boolean');
      pushCommand({ type: 'series-set-visible', key: resource.key, visible });
    },
  });

  const createCanvasHandle = (resource) => safeFreeze({
    key: resource.key,
    setCommands(commands) {
      requireUpdatePhase('canvasLayer.setCommands');
      pushCommand({
        type: 'canvas-set-commands',
        key: resource.key,
        commands: validateCanvasCommands(commands, resource, 'canvasLayer.setCommands commands'),
      });
    },
    setVisible(visible) {
      if (currentPhase !== 'create' && currentPhase !== 'update') invalidOutput('canvasLayer.setVisible is only allowed inside create/update callbacks');
      if (typeof visible !== 'boolean') invalidOutput('canvasLayer.setVisible visible must be boolean');
      pushCommand({ type: 'canvas-set-visible', key: resource.key, visible });
    },
  });

  const createPanelHandle = (resource) => safeFreeze({
    key: resource.key,
    set(content) {
      requireUpdatePhase('panel.set');
      pushCommand({
        type: 'panel-set',
        key: resource.key,
        content: validatePanelContent(content, 'panel.set content'),
      });
    },
  });

  const mainPaneHandle = safeFreeze({ key: 'main' });
  paneHandles.main = mainPaneHandle;
  const paneApi = safeFreeze({
    main: mainPaneHandle,
    create(definition) {
      requireCreatePhase('panes.create');
      const candidate = assertPlainObject(definition, 'pane definition');
      assertAllowedKeys(candidate, ['key', 'defaultHeight'], 'pane definition');
      if (paneCount >= MAX_PANES) outputLimit('pane limit ' + MAX_PANES + ' exceeded');
      const key = assertResourceKey(candidate.key, 'pane definition.key');
      if (key === 'main' || hasOwn(paneHandles, key)) invalidOutput('duplicate or reserved pane key ' + key);
      const defaultHeight = assertInteger(candidate.defaultHeight, 'pane definition.defaultHeight');
      if (defaultHeight < MIN_PANE_HEIGHT || defaultHeight > MAX_PANE_HEIGHT) invalidOutput('pane defaultHeight is outside the supported range');
      const handle = safeFreeze({ key });
      paneHandles[key] = handle;
      paneCount += 1;
      pushCommand({ type: 'create-pane', key, defaultHeight });
      return handle;
    },
    get(key) {
      if (typeof key !== 'string') return null;
      return hasOwn(paneHandles, key) ? paneHandles[key] : null;
    },
  });

  const layersApi = safeFreeze({
    createSeries(definition) {
      requireCreatePhase('layers.createSeries');
      const candidate = assertPlainObject(definition, 'series definition');
      assertAllowedKeys(candidate, ['key', 'type', 'pane', 'options'], 'series definition');
      if (seriesCount >= MAX_SERIES) outputLimit('series limit ' + MAX_SERIES + ' exceeded');
      const key = assertResourceKey(candidate.key, 'series definition.key');
      if (hasOwn(seriesResources, key)) invalidOutput('duplicate series key ' + key);
      let supportedType = false;
      for (let index = 0; index < SERIES_TYPES.length; index += 1) {
        if (candidate.type === SERIES_TYPES[index]) { supportedType = true; break; }
      }
      if (!supportedType) invalidOutput('unsupported series type');
      if (typeof candidate.pane !== 'string' || !hasOwn(paneHandles, candidate.pane)) invalidOutput('series pane does not exist');
      const options = validateSeriesOptions(candidate.options);
      const resource = safeFreeze({ key, seriesType: candidate.type, pane: candidate.pane });
      seriesResources[key] = resource;
      seriesCount += 1;
      pushCommand({
        type: 'create-series',
        key,
        seriesType: candidate.type,
        pane: candidate.pane,
        ...(options === undefined ? {} : { options }),
      });
      return createSeriesHandle(resource);
    },
    createCanvasLayer(definition) {
      requireCreatePhase('layers.createCanvasLayer');
      const candidate = assertPlainObject(definition, 'canvas layer definition');
      assertAllowedKeys(candidate, ['key', 'target', 'zOrder'], 'canvas layer definition');
      if (canvasLayerCount >= MAX_CANVAS_LAYERS) outputLimit('canvas layer limit ' + MAX_CANVAS_LAYERS + ' exceeded');
      const key = assertResourceKey(candidate.key, 'canvas layer definition.key');
      if (hasOwn(canvasResources, key)) invalidOutput('duplicate canvas layer key ' + key);
      const target = validateCanvasTarget(candidate.target, 'canvas layer definition.target');
      const zOrder = candidate.zOrder === undefined ? 'normal' : candidate.zOrder;
      if (typeof zOrder !== 'string' || !includesValue(CANVAS_Z_ORDERS, zOrder)) invalidOutput('canvas layer definition.zOrder is unsupported');
      const resource = safeFreeze({ key, target, zOrder });
      canvasResources[key] = resource;
      canvasLayerCount += 1;
      pushCommand({ type: 'create-canvas-layer', key, target, zOrder });
      return createCanvasHandle(resource);
    },
    createPanel(definition) {
      requireCreatePhase('layers.createPanel');
      const candidate = assertPlainObject(definition, 'panel definition');
      assertAllowedKeys(candidate, ['key', 'paneKey', 'position'], 'panel definition');
      if (panelCount >= MAX_PANELS) outputLimit('panel limit ' + MAX_PANELS + ' exceeded');
      const key = assertResourceKey(candidate.key, 'panel definition.key');
      if (hasOwn(panelResources, key)) invalidOutput('duplicate panel key ' + key);
      if (typeof candidate.paneKey !== 'string' || !hasOwn(paneHandles, candidate.paneKey)) {
        invalidOutput('panel definition.paneKey references an unknown pane');
      }
      if (typeof candidate.position !== 'string' || !includesValue(PANEL_POSITIONS, candidate.position)) {
        invalidOutput('panel definition.position is unsupported');
      }
      const resource = safeFreeze({ key, paneKey: candidate.paneKey, position: candidate.position });
      panelResources[key] = resource;
      panelCount += 1;
      pushCommand({ type: 'create-panel', key, paneKey: candidate.paneKey, position: candidate.position });
      return createPanelHandle(resource);
    },
  });

  const createMarkerHandle = (resource) => safeFreeze({
    key: resource.key,
    set(markers) {
      requireUpdatePhase('markerContribution.set');
      if (!safeIsArray(markers)) invalidOutput('markerContribution.set markers must be an array');
      callbackMarkerCount += markers.length;
      if (callbackMarkerCount > MAX_MARKERS) outputLimit('callback marker limit ' + MAX_MARKERS + ' exceeded');
      const copied = new SafeArray(markers.length);
      for (let index = 0; index < markers.length; index += 1) {
        copied[index] = validateMarker(markers[index], 'markerContribution.set markers[' + index + ']');
      }
      pushCommand({ type: 'marker-set', key: resource.key, markers: safeFreeze(copied) });
    },
  });

  const createBarStyleHandle = (resource) => safeFreeze({
    key: resource.key,
    set(styles) {
      requireUpdatePhase('barStyleContribution.set');
      if (!safeIsArray(styles)) invalidOutput('barStyleContribution.set styles must be an array');
      if (styles.length > bars.length) outputLimit('barStyleContribution.set styles exceeds current bars length');
      const copied = new SafeArray(styles.length);
      let previousTime = -Infinity;
      for (let index = 0; index < styles.length; index += 1) {
        const style = validateBarStyle(styles[index], 'barStyleContribution.set styles[' + index + ']');
        if (style.time <= previousTime) invalidOutput('barStyleContribution.set styles must be strictly increasing by time');
        previousTime = style.time;
        copied[index] = style;
      }
      pushCommand({ type: 'bar-style-set', key: resource.key, styles: safeFreeze(copied) });
    },
  });

  const mainSeriesApi = safeFreeze({
    createBarStyleContribution(definition) {
      requireCreatePhase('mainSeries.createBarStyleContribution');
      const candidate = assertPlainObject(definition, 'bar style contribution definition');
      assertAllowedKeys(candidate, ['key', 'priority', 'chartKinds'], 'bar style contribution definition');
      const key = assertResourceKey(candidate.key, 'bar style contribution definition.key');
      if (hasOwn(barStyleResources, key)) invalidOutput('duplicate bar style contribution key ' + key);
      const priority = assertInteger(candidate.priority, 'bar style contribution definition.priority');
      const chartKinds = validateBarStyleChartKinds(candidate.chartKinds, 'bar style contribution definition.chartKinds');
      const resource = safeFreeze({ key, priority, chartKinds });
      barStyleResources[key] = resource;
      pushCommand({ type: 'create-bar-style-contribution', key, priority, chartKinds });
      return createBarStyleHandle(resource);
    },
    createMarkerContribution(definition) {
      requireCreatePhase('mainSeries.createMarkerContribution');
      const candidate = assertPlainObject(definition, 'marker contribution definition');
      assertAllowedKeys(candidate, ['key', 'priority'], 'marker contribution definition');
      const key = assertResourceKey(candidate.key, 'marker contribution definition.key');
      if (hasOwn(markerResources, key)) invalidOutput('duplicate marker contribution key ' + key);
      const priority = assertInteger(candidate.priority, 'marker contribution definition.priority');
      const resource = safeFreeze({ key, priority });
      markerResources[key] = resource;
      pushCommand({ type: 'create-marker-contribution', key, priority });
      return createMarkerHandle(resource);
    },
  });

  const deepFreeze = (value) => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (safeIsArray(value)) {
      for (let index = 0; index < value.length; index += 1) deepFreeze(value[index]);
    } else {
      const keys = safeKeys(value);
      for (let index = 0; index < keys.length; index += 1) deepFreeze(value[keys[index]]);
    }
    return safeFreeze(value);
  };

  const copyBar = (bar) => {
    if (!bar || typeof bar !== 'object') fail('invalid bar payload');
    const copied = {
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    };
    if (bar.amount !== undefined) copied.amount = bar.amount;
    return safeFreeze(copied);
  };

  const copyRealtimeUpdate = (update) => {
    if (!update || typeof update !== 'object') fail('invalid realtime update payload');
    const copied = {};
    const keys = safeKeys(update);
    for (let index = 0; index < keys.length; index += 1) copied[keys[index]] = update[keys[index]];
    return safeFreeze(copied);
  };

  const applyDataEvent = (payload) => {
    if (!payload || typeof payload !== 'object' || !payload.barsPatch) fail('invalid data event payload');
    const patch = payload.barsPatch;
    if (patch.mode === 'replace-all') {
      if (!safeIsArray(patch.bars)) fail('replace-all bars must be an array');
      const next = new Array(patch.bars.length);
      for (let index = 0; index < patch.bars.length; index += 1) next[index] = copyBar(patch.bars[index]);
      bars = safeFreeze(next);
    } else if (patch.mode === 'replace-from') {
      if (!safeIsInteger(patch.baseLength) || patch.baseLength !== bars.length) {
        fail('user indicator bar mirror length mismatch');
      }
      if (!safeIsInteger(patch.from) || patch.from < 0 || patch.from > bars.length || !safeIsArray(patch.bars)) {
        fail('invalid replace-from patch');
      }
      const next = new Array(patch.from + patch.bars.length);
      for (let index = 0; index < patch.from; index += 1) next[index] = bars[index];
      for (let index = 0; index < patch.bars.length; index += 1) next[patch.from + index] = copyBar(patch.bars[index]);
      bars = safeFreeze(next);
    } else {
      fail('unsupported bars patch mode');
    }

    let realtimeUpdates;
    if (payload.realtimeUpdates !== undefined) {
      if (!safeIsArray(payload.realtimeUpdates)) fail('realtimeUpdates must be an array');
      const copied = new Array(payload.realtimeUpdates.length);
      for (let index = 0; index < payload.realtimeUpdates.length; index += 1) {
        copied[index] = copyRealtimeUpdate(payload.realtimeUpdates[index]);
      }
      realtimeUpdates = safeFreeze(copied);
    }

    let depth;
    if (payload.depth !== undefined) {
      if (!payload.depth || typeof payload.depth !== 'object'
        || !safeIsArray(payload.depth.bids) || !safeIsArray(payload.depth.asks)) {
        fail('invalid depth payload');
      }
      if (payload.depth.bids.length > ${USER_INDICATOR_RUNTIME_LIMITS.depthLevelsPerSide}
        || payload.depth.asks.length > ${USER_INDICATOR_RUNTIME_LIMITS.depthLevelsPerSide}) {
        fail('depth payload exceeds host budget');
      }
      depth = deepFreeze(payload.depth);
    }

    let trades;
    if (payload.trades !== undefined) {
      if (!payload.trades || typeof payload.trades !== 'object' || !safeIsArray(payload.trades.events)) {
        fail('invalid trades payload');
      }
      if (payload.trades.events.length > ${USER_INDICATOR_RUNTIME_LIMITS.tradesPerCallback}) {
        fail('trades payload exceeds host budget');
      }
      trades = deepFreeze(payload.trades);
    }

    let marketStatus;
    if (payload.marketStatus !== undefined) {
      if (!payload.marketStatus || typeof payload.marketStatus !== 'object') fail('invalid market status payload');
      const state = payload.marketStatus.state;
      if (state !== 'connecting' && state !== 'available' && state !== 'disconnected' && state !== 'degraded') {
        fail('invalid market status state');
      }
      marketStatus = deepFreeze(payload.marketStatus);
    }

    return safeFreeze({
      reason: payload.reason,
      changedFrom: payload.changedFrom,
      bars,
      ...(realtimeUpdates === undefined ? {} : { realtimeUpdates }),
      ...(depth === undefined ? {} : { depth }),
      ...(trades === undefined ? {} : { trades }),
      ...(marketStatus === undefined ? {} : { marketStatus }),
    });
  };

  const assertSync = (value) => {
    if (
      value !== null
      && (typeof value === 'object' || typeof value === 'function')
      && typeof value.then === 'function'
    ) {
      fail('TRADEFLOW_ASYNC_NOT_SUPPORTED');
    }
    return value;
  };

  const defineIndicator = (definition) => {
    definitionCount += 1;
    if (definitionCount !== 1) return;
    if (!definition || typeof definition !== 'object') return;
    formatVersion = definition.formatVersion;
    apiVersion = definition.apiVersion;
    createCallback = definition.create;
  };

  const bridge = (secret, operation, payloadJson) => {
    if (secret !== BRIDGE_SECRET) fail('user indicator runtime bridge access denied');

    if (operation === 'status') {
      return safeStringify({
        definitionCount,
        formatVersion,
        apiVersion,
        hasCreate: typeof createCallback === 'function',
        hasPointer: typeof pointerCallback === 'function',
      });
    }

    const payload = safeParse(payloadJson);
    if (operation === 'create') {
      if (lifecycle !== null) fail('user indicator lifecycle already created');
      if (typeof createCallback !== 'function') fail('user indicator create callback is missing');
      const rawContext = assertPlainObject(payload.context, 'runtime context');
      const rawData = rawContext.data === undefined
        ? safeCreate(null)
        : assertPlainObject(rawContext.data, 'runtime context.data');
      const rawDataStatus = rawContext.dataStatus === undefined
        ? safeCreate(null)
        : assertPlainObject(rawContext.dataStatus, 'runtime context.dataStatus');
      const dataSnapshots = deepFreeze(rawData);
      const dataStatuses = deepFreeze(rawDataStatus);
      const dataApi = safeFreeze({
        get: (key) => {
          if (typeof key !== 'string') fail('context.data.get key must be a string');
          return hasOwn(dataSnapshots, key) ? dataSnapshots[key] : null;
        },
        status: (key) => {
          if (typeof key !== 'string') fail('context.data.status key must be a string');
          return hasOwn(dataStatuses, key) ? dataStatuses[key] : null;
        },
      });
      const trustedContext = safeCreate(null);
      const contextKeys = safeKeys(rawContext);
      for (let index = 0; index < contextKeys.length; index += 1) {
        const key = contextKeys[index];
        if (key !== 'panes' && key !== 'layers' && key !== 'mainSeries' && key !== 'data' && key !== 'dataStatus') trustedContext[key] = rawContext[key];
      }
      trustedContext.panes = paneApi;
      trustedContext.layers = layersApi;
      trustedContext.mainSeries = mainSeriesApi;
      trustedContext.data = dataApi;
      trustedContext.log = debugLog;
      deepFreeze(trustedContext);
      const trustedInputs = deepFreeze(payload.inputs);
      beginCallback('create', null);
      try {
        const created = assertSync(safeApply(createCallback, undefined, [trustedContext, trustedInputs]));
        if (!created || (typeof created !== 'object' && typeof created !== 'function')) {
          fail('user indicator create() must return a lifecycle object');
        }
        const nextUpdate = created.update;
        if (typeof nextUpdate !== 'function') fail('user indicator lifecycle.update must be a function');
        const nextPointer = created.onPointer;
        if (nextPointer !== undefined && typeof nextPointer !== 'function') fail('user indicator lifecycle.onPointer must be a function when present');
        lifecycle = created;
        updateCallback = nextUpdate;
        pointerCallback = nextPointer === undefined ? null : nextPointer;
        return finishCallback();
      } catch (error) {
        return finishFailedCallback(error);
      }
    }

    if (operation === 'update') {
      if (lifecycle === null || typeof updateCallback !== 'function') fail('user indicator lifecycle is not created');
      const runtimeEvent = applyDataEvent(payload.event);
      beginCallback('update', safeFreeze({
        reason: runtimeEvent.reason,
        changedFrom: runtimeEvent.changedFrom,
      }));
      try {
        assertSync(safeApply(updateCallback, lifecycle, [runtimeEvent]));
        return finishCallback();
      } catch (error) {
        return finishFailedCallback(error);
      }
    }

    if (operation === 'pointer') {
      if (lifecycle === null) fail('user indicator lifecycle is not created');
      const rawEvent = assertPlainObject(payload.event, 'pointer event');
      assertAllowedKeys(rawEvent, ['type', 'id', 'time', 'price', 'pane'], 'pointer event');
      if (rawEvent.type !== 'click' && rawEvent.type !== 'hover' && rawEvent.type !== 'leave') {
        fail('pointer event.type is unsupported');
      }
      const pointerEvent = safeCreate(null);
      pointerEvent.type = rawEvent.type;
      pointerEvent.id = assertTextField(rawEvent.id, 'pointer event.id');
      pointerEvent.pane = assertResourceKey(rawEvent.pane, 'pointer event.pane');
      if (rawEvent.time !== null) pointerEvent.time = assertInteger(rawEvent.time, 'pointer event.time');
      else pointerEvent.time = null;
      if (rawEvent.price !== null) pointerEvent.price = assertFinite(rawEvent.price, 'pointer event.price');
      else pointerEvent.price = null;
      const frozenPointer = safeFreeze(pointerEvent);
      beginCallback('pointer', frozenPointer);
      try {
        if (typeof pointerCallback === 'function') assertSync(safeApply(pointerCallback, lifecycle, [frozenPointer]));
        return finishCallback();
      } catch (error) {
        return finishFailedCallback(error);
      }
    }

    fail('unsupported user indicator runtime bridge operation');
  };

  safeDefineProperty(globalThis, 'defineIndicator', {
    value: defineIndicator,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  safeDefineProperty(globalThis, '__tradeflowRuntimeBridge', {
    value: bridge,
    enumerable: false,
    configurable: false,
    writable: false,
  });
})();
`;
}

type VmEvaluation =
  | { readonly ok: true; readonly value?: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly logs?: readonly UserIndicatorExecutionLog[] } };

type TimedVmEvaluation = VmEvaluation & Readonly<{ durationMs: number; budgetMs: number }>;

export class UserIndicatorExecutionEngine {
  private readonly runtime: QuickJSRuntime;
  private readonly context: QuickJSContext;
  private readonly bridgeSecret: string;
  private poisoned = false;
  private created = false;
  private disposed = false;
  private outputState: UserIndicatorOutputValidationState = createUserIndicatorOutputValidationState();
  private mirroredBarsLength = 0;

  private callbackLogs(value: unknown, expectedPhase: UserIndicatorExecutionLog['phase']): readonly UserIndicatorExecutionLog[] {
    try {
      const parsed = JSON.parse(String(value ?? '')) as { phase?: unknown; commands?: unknown };
      if (!parsed || parsed.phase !== expectedPhase || !Array.isArray(parsed.commands)) return Object.freeze([]);
      const logs: UserIndicatorExecutionLog[] = [];
      for (const command of parsed.commands) {
        if (!command || typeof command !== 'object') continue;
        const item = command as { type?: unknown; message?: unknown };
        if (item.type === 'debug-log' && typeof item.message === 'string') {
          logs.push(Object.freeze({
            phase: expectedPhase,
            message: item.message.slice(0, USER_INDICATOR_RUNTIME_LIMITS.textFieldChars),
          }));
        }
      }
      return Object.freeze(logs.slice(0, USER_INDICATOR_RUNTIME_LIMITS.consoleEntriesPerCallback));
    } catch {
      return Object.freeze([]);
    }
  }

  private normalizeCallbackEvaluation(
    result: VmEvaluation,
    expectedPhase: UserIndicatorExecutionLog['phase'],
  ): VmEvaluation {
    if (!result.ok) return result;
    try {
      const parsed = JSON.parse(String(result.value ?? '')) as {
        __tradeflowCallbackFailure?: unknown;
        phase?: unknown;
        message?: unknown;
        logs?: unknown;
      };
      if (parsed?.__tradeflowCallbackFailure !== 1) return result;
      if (parsed.phase !== expectedPhase || typeof parsed.message !== 'string' || !Array.isArray(parsed.logs)) {
        this.poisoned = true;
        return { ok: false, error: { code: 'invalid_output', message: 'runtime callback failure envelope is invalid' } };
      }
      const logs: UserIndicatorExecutionLog[] = [];
      for (const raw of parsed.logs.slice(0, USER_INDICATOR_RUNTIME_LIMITS.consoleEntriesPerCallback)) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as { phase?: unknown; message?: unknown };
        if (item.phase !== expectedPhase || typeof item.message !== 'string') continue;
        logs.push(Object.freeze({
          phase: expectedPhase,
          message: item.message.slice(0, USER_INDICATOR_RUNTIME_LIMITS.textFieldChars),
        }));
      }
      this.poisoned = true;
      const classified = classifyRuntimeError(parsed.message);
      return { ok: false, error: { ...classified, logs: Object.freeze(logs) } };
    } catch {
      return result;
    }
  }

  private constructor(runtime: QuickJSRuntime, context: QuickJSContext, bridgeSecret: string) {
    this.runtime = runtime;
    this.context = context;
    this.bridgeSecret = bridgeSecret;
  }

  static async create(): Promise<UserIndicatorExecutionEngine> {
    const quickJs = await getQuickJs();
    const runtime = quickJs.newRuntime();
    runtime.setMemoryLimit(USER_INDICATOR_RUNTIME_LIMITS.quickJsHeapBytes);
    runtime.setMaxStackSize(USER_INDICATOR_RUNTIME_LIMITS.quickJsStackBytes);
    const context = runtime.newContext();
    const engine = new UserIndicatorExecutionEngine(runtime, context, createBridgeSecret());
    const bootstrap = engine.evaluateTrusted(
      runtimeBootstrap(engine.bridgeSecret),
      'tradeflow-user-indicator-runtime-bootstrap.js',
      USER_INDICATOR_RUNTIME_LIMITS.definitionVmMs,
    );
    if (!bootstrap.ok) {
      engine.dispose();
      throw new Error(`user indicator runtime bootstrap failed: ${bootstrap.error.message}`);
    }
    return engine;
  }

  createInstance(request: UserIndicatorExecutionCreateRequest): UserIndicatorExecutionResponse {
    if (this.created || this.poisoned || this.disposed) {
      return this.failure(request, 'runtime_exception', 'user indicator runtime instance is not reusable');
    }
    if (new TextEncoder().encode(request.source).byteLength > USER_INDICATOR_RUNTIME_LIMITS.sourceBytes) {
      return this.failure(
        request,
        'source_too_large',
        `indicator source exceeds ${USER_INDICATOR_RUNTIME_LIMITS.sourceBytes} bytes`,
      );
    }

    const sourceResult = this.evaluateGuest(
      request.source,
      'user-indicator.tfi',
      USER_INDICATOR_RUNTIME_LIMITS.definitionVmMs,
    );
    if (!sourceResult.ok) return this.failure(request, sourceResult.error.code, sourceResult.error.message);

    const statusResult = this.evaluateGuest(
      `__tradeflowRuntimeBridge(${JSON.stringify(this.bridgeSecret)}, 'status', 'null')`,
      'tradeflow-user-indicator-runtime-status.js',
      USER_INDICATOR_RUNTIME_LIMITS.definitionVmMs,
      true,
    );
    if (!statusResult.ok) return this.failure(request, statusResult.error.code, statusResult.error.message);

    let status: {
      definitionCount?: unknown;
      formatVersion?: unknown;
      apiVersion?: unknown;
      hasCreate?: unknown;
      hasPointer?: unknown;
    };
    try {
      status = JSON.parse(String(statusResult.value ?? '')) as typeof status;
    } catch (error) {
      this.poisoned = true;
      return this.failure(request, 'runtime_exception', `invalid runtime definition status: ${errorMessage(error)}`);
    }
    if (status.definitionCount === 0) {
      return this.failure(request, 'definition_missing', 'indicator source must call defineIndicator() exactly once');
    }
    if (status.definitionCount !== 1) {
      return this.failure(request, 'definition_duplicate', 'indicator source must call defineIndicator() exactly once');
    }
    if (status.formatVersion !== USER_INDICATOR_FORMAT_VERSION) {
      return this.failure(
        request,
        'unsupported_format_version',
        `unsupported .tfi formatVersion ${JSON.stringify(status.formatVersion)}; expected ${USER_INDICATOR_FORMAT_VERSION}`,
      );
    }
    if (status.apiVersion !== USER_INDICATOR_API_VERSION) {
      return this.failure(
        request,
        'unsupported_user_api_version',
        `unsupported user indicator apiVersion ${JSON.stringify(status.apiVersion)}; expected ${USER_INDICATOR_API_VERSION}`,
      );
    }
    if (status.hasCreate !== true) {
      return this.failure(request, 'invalid_definition', 'create must be a function');
    }

    let createPayload: string;
    try {
      createPayload = encodePayload({ context: request.context, inputs: request.inputs });
    } catch (error) {
      return this.failure(request, 'runtime_exception', errorMessage(error));
    }
    const createResult = this.normalizeCallbackEvaluation(this.evaluateGuest(
      `__tradeflowRuntimeBridge(${JSON.stringify(this.bridgeSecret)}, 'create', ${createPayload})`,
      'tradeflow-user-indicator-create.js',
      USER_INDICATOR_RUNTIME_LIMITS.createVmMs,
      true,
    ), 'create');
    if (!createResult.ok) {
      return this.failure(request, createResult.error.code, createResult.error.message, 'create', createResult.error.logs);
    }
    const createLogs = this.callbackLogs(createResult.value, 'create');
    const lifecycleStatusResult = this.evaluateGuest(
      `__tradeflowRuntimeBridge(${JSON.stringify(this.bridgeSecret)}, 'status', 'null')`,
      'tradeflow-user-indicator-runtime-status.js',
      USER_INDICATOR_RUNTIME_LIMITS.definitionVmMs,
      true,
    );
    if (!lifecycleStatusResult.ok) {
      return this.failure(
        request,
        lifecycleStatusResult.error.code,
        lifecycleStatusResult.error.message,
        'create',
        Object.freeze([...createLogs, ...(lifecycleStatusResult.error.logs ?? [])]),
      );
    }
    let pointerEnabled = false;
    try {
      const lifecycleStatus = JSON.parse(String(lifecycleStatusResult.value ?? '')) as { hasPointer?: unknown };
      pointerEnabled = lifecycleStatus.hasPointer === true;
    } catch (error) {
      this.poisoned = true;
      return this.failure(
        request,
        'runtime_exception',
        `invalid runtime lifecycle status: ${errorMessage(error)}`,
        'create',
        createLogs,
      );
    }

    const initialResult = this.dispatchUpdate(request.initialEvent);
    if (!initialResult.ok) {
      return this.failure(
        request,
        initialResult.error.code,
        initialResult.error.message,
        'update',
        Object.freeze([...createLogs, ...(initialResult.error.logs ?? [])]),
      );
    }
    const initialLogs = this.callbackLogs(initialResult.value, 'update');

    const initialBarsLength = request.initialEvent.barsPatch.mode === 'replace-all'
      ? request.initialEvent.barsPatch.bars.length
      : request.initialEvent.barsPatch.from + request.initialEvent.barsPatch.bars.length;
    const output = this.validateOutput(
      {
        callbacks: [
          this.parseCallbackOutput(createResult.value, 'create'),
          this.parseCallbackOutput(initialResult.value, 'update'),
        ],
      },
      {
        type: 'create',
        reason: request.initialEvent.reason,
        changedFrom: request.initialEvent.changedFrom,
        barsLength: initialBarsLength,
      },
    );
    if (!output.ok) {
      return this.failure(
        request,
        output.error.code,
        output.error.message,
        output.error.phase,
        Object.freeze([...createLogs, ...initialLogs]),
      );
    }

    this.created = true;
    this.mirroredBarsLength = initialBarsLength;
    return {
      protocolVersion: USER_INDICATOR_EXECUTION_PROTOCOL_VERSION,
      type: 'success',
      phase: 'create',
      instanceId: request.instanceId,
      generation: request.generation,
      requestId: request.requestId,
      output: output.output,
      pointerEnabled,
      timing: Object.freeze({
        reason: request.initialEvent.reason,
        durationMs: initialResult.durationMs,
        budgetMs: initialResult.budgetMs,
      }),
    };
  }

  updateInstance(request: UserIndicatorExecutionUpdateRequest): UserIndicatorExecutionResponse {
    if (!this.created || this.poisoned || this.disposed) {
      return this.failure(request, 'runtime_exception', 'user indicator runtime instance is not running');
    }
    const updateResult = this.dispatchUpdate(request.event);
    if (!updateResult.ok) {
      return this.failure(request, updateResult.error.code, updateResult.error.message, 'update', updateResult.error.logs);
    }
    const updateLogs = this.callbackLogs(updateResult.value, 'update');
    if (request.event.barsPatch.mode === 'replace-from'
      && request.event.barsPatch.baseLength !== this.mirroredBarsLength) {
      this.poisoned = true;
      return this.failure(
        request,
        'invalid_output',
        `runtime bar mirror length mismatch: expected ${this.mirroredBarsLength}, received ${request.event.barsPatch.baseLength}`,
      );
    }
    const barsLength = request.event.barsPatch.mode === 'replace-all'
      ? request.event.barsPatch.bars.length
      : request.event.barsPatch.from + request.event.barsPatch.bars.length;
    const output = this.validateOutput(
      { callbacks: [this.parseCallbackOutput(updateResult.value, 'update')] },
      {
        type: 'update',
        reason: request.event.reason,
        changedFrom: request.event.changedFrom,
        barsLength,
      },
    );
    if (!output.ok) return this.failure(request, output.error.code, output.error.message, output.error.phase, updateLogs);
    this.mirroredBarsLength = barsLength;
    return {
      protocolVersion: USER_INDICATOR_EXECUTION_PROTOCOL_VERSION,
      type: 'success',
      phase: 'update',
      instanceId: request.instanceId,
      generation: request.generation,
      requestId: request.requestId,
      output: output.output,
      timing: Object.freeze({
        reason: request.event.reason,
        durationMs: updateResult.durationMs,
        budgetMs: updateResult.budgetMs,
      }),
    };
  }

  pointerInstance(request: UserIndicatorExecutionPointerRequest): UserIndicatorExecutionResponse {
    if (!this.created || this.poisoned || this.disposed) {
      return this.failure(request, 'runtime_exception', 'user indicator runtime instance is not running');
    }
    let payload: string;
    try { payload = encodePayload({ event: request.event }); }
    catch (error) { return this.failure(request, 'runtime_exception', errorMessage(error)); }
    const budgetMs = USER_INDICATOR_RUNTIME_LIMITS.pointerVmMs;
    const started = performance.now();
    const pointerResult = this.normalizeCallbackEvaluation(this.evaluateGuest(
      `__tradeflowRuntimeBridge(${JSON.stringify(this.bridgeSecret)}, 'pointer', ${payload})`,
      'tradeflow-user-indicator-pointer.js',
      budgetMs,
      true,
    ), 'pointer');
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    if (!pointerResult.ok) {
      const message = pointerResult.error.code === 'execution_timeout'
        ? `TRADEFLOW_TIMEOUT: onPointer(${request.event.type}) exceeded ${budgetMs}ms budget`
        : pointerResult.error.message;
      return this.failure(request, pointerResult.error.code, message, 'pointer', pointerResult.error.logs);
    }
    const pointerLogs = this.callbackLogs(pointerResult.value, 'pointer');
    const output = this.validateOutput(
      { callbacks: [this.parseCallbackOutput(pointerResult.value, 'pointer')] },
      {
        type: 'pointer',
        pointerType: request.event.type,
        id: request.event.id,
        time: request.event.time,
        price: request.event.price,
        pane: request.event.pane,
        barsLength: this.mirroredBarsLength,
      },
    );
    if (!output.ok) return this.failure(request, output.error.code, output.error.message, output.error.phase, pointerLogs);
    return {
      protocolVersion: USER_INDICATOR_EXECUTION_PROTOCOL_VERSION,
      type: 'success',
      phase: 'pointer',
      instanceId: request.instanceId,
      generation: request.generation,
      requestId: request.requestId,
      output: output.output,
      timing: Object.freeze({ reason: 'pointer', durationMs, budgetMs }),
    };
  }

  isPoisoned(): boolean {
    return this.poisoned;
  }

  dispose(): void {
    if (this.disposed || this.poisoned) return;
    this.disposed = true;
    this.context.dispose();
    this.runtime.dispose();
  }

  private dispatchUpdate(
    event: UserIndicatorExecutionCreateRequest['initialEvent'] | UserIndicatorExecutionUpdateRequest['event'],
  ): TimedVmEvaluation {
    const vmMs = userIndicatorUpdateVmMs(event.reason);
    let payload: string;
    try {
      payload = encodePayload({ event });
    } catch (error) {
      return {
        ok: false,
        error: { code: 'runtime_exception', message: errorMessage(error) },
        durationMs: 0,
        budgetMs: vmMs,
      };
    }
    const started = performance.now();
    const result = this.normalizeCallbackEvaluation(this.evaluateGuest(
      `__tradeflowRuntimeBridge(${JSON.stringify(this.bridgeSecret)}, 'update', ${payload})`,
      'tradeflow-user-indicator-update.js',
      vmMs,
      true,
    ), 'update');
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    if (!result.ok && result.error.code === 'execution_timeout') {
      return {
        ok: false,
        error: {
          code: 'execution_timeout',
          message: `TRADEFLOW_TIMEOUT: update(${event.reason}) exceeded ${vmMs}ms budget`,
          ...(result.error.logs ? { logs: result.error.logs } : {}),
        },
        durationMs,
        budgetMs: vmMs,
      };
    }
    return { ...result, durationMs, budgetMs: vmMs };
  }

  private parseCallbackOutput(
    value: unknown,
    expectedPhase: UserIndicatorCallbackOutput['phase'],
  ): unknown {
    try {
      const parsed = JSON.parse(String(value ?? '')) as unknown;
      if (!parsed || typeof parsed !== 'object' || (parsed as { phase?: unknown }).phase !== expectedPhase) {
        throw new Error(`runtime callback output did not report phase ${expectedPhase}`);
      }
      return parsed;
    } catch (error) {
      this.poisoned = true;
      throw new UserIndicatorOutputError(
        'invalid_output',
        `runtime callback output could not be decoded: ${errorMessage(error)}`,
        expectedPhase,
      );
    }
  }

  private validateOutput(
    value: unknown,
    expectation: UserIndicatorOutputExpectation,
  ):
    | { readonly ok: true; readonly output: UserIndicatorOutputEnvelope }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly phase?: UserIndicatorCallbackOutput['phase'] } } {
    try {
      const validated = validateUserIndicatorOutputEnvelope(value, this.outputState, expectation);
      this.outputState = validated.state;
      return { ok: true, output: validated.output };
    } catch (error) {
      this.poisoned = true;
      if (error instanceof UserIndicatorOutputError) {
        return { ok: false, error: { code: error.code, message: error.message, ...(error.phase ? { phase: error.phase } : {}) } };
      }
      return { ok: false, error: { code: 'invalid_output', message: errorMessage(error) } };
    }
  }

  private evaluateTrusted(code: string, filename: string, vmMs: number): VmEvaluation {
    return this.evaluate(code, filename, vmMs, false, false);
  }

  private evaluateGuest(
    code: string,
    filename: string,
    vmMs: number,
    captureValue = false,
  ): VmEvaluation {
    return this.evaluate(code, filename, vmMs, true, captureValue);
  }

  private evaluate(
    code: string,
    filename: string,
    vmMs: number,
    poisonOnFailure: boolean,
    captureValue: boolean,
  ): VmEvaluation {
    if (this.poisoned || this.disposed) {
      return { ok: false, error: { code: 'runtime_exception', message: 'user indicator runtime is unavailable' } };
    }
    this.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + vmMs));
    try {
      const result = this.context.evalCode(code, filename, { type: 'global', strict: true });
      if (result.error) {
        const dumped = this.context.dump(result.error);
        result.error.dispose();
        if (poisonOnFailure) this.poisoned = true;
        return { ok: false, error: classifyRuntimeError(dumped) };
      }
      let value: unknown;
      if (result.value) {
        if (captureValue) value = this.context.dump(result.value);
        result.value.dispose();
      }
      if (this.runtime.hasPendingJob()) {
        this.poisoned = true;
        return {
          ok: false,
          error: {
            code: 'async_not_supported',
            message: 'user indicator callbacks must be synchronous; pending Promise/async jobs are not supported',
          },
        };
      }
      return captureValue ? { ok: true, value } : { ok: true };
    } catch (error) {
      if (poisonOnFailure) this.poisoned = true;
      return { ok: false, error: classifyRuntimeError(error) };
    } finally {
      this.runtime.removeInterruptHandler();
    }
  }

  private failure(
    request: UserIndicatorExecutionCreateRequest | UserIndicatorExecutionUpdateRequest | UserIndicatorExecutionPointerRequest,
    code: string,
    message: string,
    phase: UserIndicatorExecutionFailure['phase'] = request.type,
    logs?: readonly UserIndicatorExecutionLog[],
  ): UserIndicatorExecutionFailure {
    return {
      protocolVersion: USER_INDICATOR_EXECUTION_PROTOCOL_VERSION,
      type: 'failure',
      phase,
      instanceId: request.instanceId,
      generation: request.generation,
      requestId: request.requestId,
      code,
      message,
      ...(logs?.length ? { logs } : {}),
    };
  }
}

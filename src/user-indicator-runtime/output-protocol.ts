import { USER_INDICATOR_RUNTIME_LIMITS } from './limits.ts';

export type UserIndicatorSeriesType = 'line' | 'histogram' | 'area' | 'baseline' | 'bar';

export type UserIndicatorSeriesOptions = Readonly<{
  color?: string;
  lineWidth?: number;
  priceLineVisible?: boolean;
  lastValueVisible?: boolean;
  visible?: boolean;
}>;

export type UserIndicatorValuePoint = Readonly<{
  time: number;
  value?: number;
  color?: string;
}>;

export type UserIndicatorBarPoint = Readonly<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  color?: string;
}>;

export type UserIndicatorSeriesPoint = UserIndicatorValuePoint | UserIndicatorBarPoint;

export type UserIndicatorMarkerBarPosition = 'aboveBar' | 'belowBar' | 'inBar';
export type UserIndicatorMarkerPricePosition = 'atPriceTop' | 'atPriceBottom' | 'atPriceMiddle';
export type UserIndicatorMarkerPosition = UserIndicatorMarkerBarPosition | UserIndicatorMarkerPricePosition;
export type UserIndicatorMarkerShape = 'circle' | 'square' | 'arrowUp' | 'arrowDown';

export type UserIndicatorMarker = Readonly<{
  time: number;
  position: UserIndicatorMarkerPosition;
  shape: UserIndicatorMarkerShape;
  color: string;
  price?: number;
  id?: string;
  text?: string;
  textColor?: string;
  tooltip?: string;
  size?: number;
  hitTest?: boolean;
}>;

export type UserIndicatorBarStyleChartKind = 'candles' | 'bars' | 'line' | 'area' | 'baseline';

export type UserIndicatorBarStyle = Readonly<{
  time: number;
  color?: string;
  borderColor?: string;
  wickColor?: string;
}>;

export type UserIndicatorCanvasZOrder = 'bottom' | 'normal' | 'top';
export type UserIndicatorCanvasDash = 'solid' | 'dashed' | 'dotted';
export type UserIndicatorCanvasTextAlign = 'left' | 'center' | 'right';

export type UserIndicatorCanvasTarget =
  | Readonly<{ type: 'current-main-series' }>
  | Readonly<{ type: 'pane'; pane: string }>
  | Readonly<{ type: 'series'; series: string }>;

export type UserIndicatorCanvasPoint =
  | Readonly<{ space: 'time-price'; time: number; price: number }>
  | Readonly<{ space: 'time-pixel'; time: number; y: number }>
  | Readonly<{ space: 'pane-pixel'; x: number; y: number }>;

export type UserIndicatorCanvasCommand =
  | Readonly<{
      type: 'line';
      id?: string;
      hitTest?: boolean;
      from: UserIndicatorCanvasPoint;
      to: UserIndicatorCanvasPoint;
      color: string;
      lineWidth?: number;
      dash?: UserIndicatorCanvasDash;
    }>
  | Readonly<{
      type: 'polyline';
      id?: string;
      hitTest?: boolean;
      points: readonly UserIndicatorCanvasPoint[];
      color: string;
      lineWidth?: number;
      dash?: UserIndicatorCanvasDash;
    }>
  | Readonly<{
      type: 'polygon';
      id?: string;
      hitTest?: boolean;
      points: readonly UserIndicatorCanvasPoint[];
      fillColor?: string;
      borderColor?: string;
      lineWidth?: number;
      dash?: UserIndicatorCanvasDash;
    }>
  | Readonly<{
      type: 'rect';
      id?: string;
      hitTest?: boolean;
      from: UserIndicatorCanvasPoint;
      to: UserIndicatorCanvasPoint;
      fillColor?: string;
      borderColor?: string;
      lineWidth?: number;
      dash?: UserIndicatorCanvasDash;
    }>
  | Readonly<{
      type: 'circle';
      id?: string;
      hitTest?: boolean;
      at: UserIndicatorCanvasPoint;
      radius: number;
      fillColor?: string;
      borderColor?: string;
      lineWidth?: number;
      dash?: UserIndicatorCanvasDash;
    }>
  | Readonly<{
      type: 'text';
      id?: string;
      hitTest?: boolean;
      at: UserIndicatorCanvasPoint;
      text: string;
      color: string;
      fontSize: number;
      align?: UserIndicatorCanvasTextAlign;
    }>;

export type UserIndicatorPanelPosition =
  | 'top-left'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-right';

export type UserIndicatorPanelAlign = 'left' | 'center' | 'right';

export type UserIndicatorPanelColumn = Readonly<{
  key: string;
  title: string;
  align?: UserIndicatorPanelAlign;
}>;

export type UserIndicatorPanelCell = Readonly<{
  text: string;
  color?: string;
}>;

export type UserIndicatorPanelRow = Readonly<{
  cells: readonly UserIndicatorPanelCell[];
}>;

export type UserIndicatorPanelContent = Readonly<{
  title?: string;
  columns: readonly UserIndicatorPanelColumn[];
  rows: readonly UserIndicatorPanelRow[];
}>;

export type UserIndicatorOutputCommand =
  | Readonly<{ type: 'create-pane'; key: string; defaultHeight: number }>
  | Readonly<{
      type: 'create-series';
      key: string;
      seriesType: UserIndicatorSeriesType;
      pane: string;
      options?: UserIndicatorSeriesOptions;
    }>
  | Readonly<{
      type: 'series-set-values';
      key: string;
      values: readonly (number | null)[];
      dirtyFrom?: number;
    }>
  | Readonly<{ type: 'series-set-data'; key: string; points: readonly UserIndicatorSeriesPoint[] }>
  | Readonly<{ type: 'series-update'; key: string; point: UserIndicatorSeriesPoint }>
  | Readonly<{ type: 'series-set-visible'; key: string; visible: boolean }>
  | Readonly<{ type: 'create-marker-contribution'; key: string; priority: number }>
  | Readonly<{ type: 'marker-set'; key: string; markers: readonly UserIndicatorMarker[] }>
  | Readonly<{
      type: 'create-bar-style-contribution';
      key: string;
      priority: number;
      chartKinds: readonly UserIndicatorBarStyleChartKind[];
    }>
  | Readonly<{ type: 'bar-style-set'; key: string; styles: readonly UserIndicatorBarStyle[] }>
  | Readonly<{
      type: 'create-canvas-layer';
      key: string;
      target: UserIndicatorCanvasTarget;
      zOrder: UserIndicatorCanvasZOrder;
    }>
  | Readonly<{ type: 'canvas-set-commands'; key: string; commands: readonly UserIndicatorCanvasCommand[] }>
  | Readonly<{ type: 'canvas-set-visible'; key: string; visible: boolean }>
  | Readonly<{ type: 'debug-log'; message: string }>
  | Readonly<{
      type: 'create-panel';
      key: string;
      paneKey: string;
      position: UserIndicatorPanelPosition;
    }>
  | Readonly<{ type: 'panel-set'; key: string; content: UserIndicatorPanelContent }>;

export type UserIndicatorCreateCallbackOutput = Readonly<{
  phase: 'create';
  commands: readonly UserIndicatorOutputCommand[];
}>;

export type UserIndicatorUpdateCallbackOutput = Readonly<{
  phase: 'update';
  reason: 'initial' | 'history' | 'realtime' | 'reconciliation';
  changedFrom: number;
  barsLength: number;
  commands: readonly UserIndicatorOutputCommand[];
}>;

export type UserIndicatorPointerCallbackOutput = Readonly<{
  phase: 'pointer';
  pointerType: 'click' | 'hover' | 'leave';
  id: string;
  time: number | null;
  price: number | null;
  pane: string;
  commands: readonly UserIndicatorOutputCommand[];
}>;

export type UserIndicatorCallbackOutput = UserIndicatorCreateCallbackOutput | UserIndicatorUpdateCallbackOutput | UserIndicatorPointerCallbackOutput;

export type UserIndicatorOutputEnvelope = Readonly<{
  callbacks: readonly UserIndicatorCallbackOutput[];
}>;

export type UserIndicatorOutputExpectation =
  | Readonly<{
      type: 'create';
      reason: UserIndicatorUpdateCallbackOutput['reason'];
      changedFrom: number;
      barsLength: number;
    }>
  | Readonly<{
      type: 'update';
      reason: UserIndicatorUpdateCallbackOutput['reason'];
      changedFrom: number;
      barsLength: number;
    }>
  | Readonly<{
      type: 'pointer';
      pointerType: UserIndicatorPointerCallbackOutput['pointerType'];
      id: string;
      time: number | null;
      price: number | null;
      pane: string;
      barsLength: number;
    }>;

type SeriesResource = Readonly<{
  type: UserIndicatorSeriesType;
  pane: string;
}>;

type CanvasResource = Readonly<{
  target: UserIndicatorCanvasTarget;
}>;

type PanelResource = Readonly<{
  paneKey: string;
  position: UserIndicatorPanelPosition;
}>;

export type UserIndicatorOutputValidationState = Readonly<{
  panes: ReadonlySet<string>;
  series: ReadonlyMap<string, SeriesResource>;
  markers: ReadonlySet<string>;
  barStyles: ReadonlySet<string>;
  canvases: ReadonlyMap<string, CanvasResource>;
  panels: ReadonlyMap<string, PanelResource>;
}>;

export type ValidatedUserIndicatorOutput = Readonly<{
  output: UserIndicatorOutputEnvelope;
  state: UserIndicatorOutputValidationState;
}>;

export type UserIndicatorOutputErrorCode = 'invalid_output' | 'output_limit_exceeded';

export class UserIndicatorOutputError extends Error {
  readonly code: UserIndicatorOutputErrorCode;
  readonly phase?: UserIndicatorCallbackOutput['phase'];

  constructor(code: UserIndicatorOutputErrorCode, message: string, phase?: UserIndicatorCallbackOutput['phase']) {
    super(message);
    this.name = 'UserIndicatorOutputError';
    this.code = code;
    this.phase = phase;
  }
}

type UnknownRecord = Record<string, unknown>;

const SERIES_TYPES = new Set<UserIndicatorSeriesType>(['line', 'histogram', 'area', 'baseline', 'bar']);
const MARKER_BAR_POSITIONS = new Set<UserIndicatorMarkerBarPosition>(['aboveBar', 'belowBar', 'inBar']);
const MARKER_PRICE_POSITIONS = new Set<UserIndicatorMarkerPricePosition>(['atPriceTop', 'atPriceBottom', 'atPriceMiddle']);
const MARKER_SHAPES = new Set<UserIndicatorMarkerShape>(['circle', 'square', 'arrowUp', 'arrowDown']);
const BAR_STYLE_CHART_KINDS = new Set<UserIndicatorBarStyleChartKind>(['candles', 'bars', 'line', 'area', 'baseline']);
const CANVAS_Z_ORDERS = new Set<UserIndicatorCanvasZOrder>(['bottom', 'normal', 'top']);
const CANVAS_DASHES = new Set<UserIndicatorCanvasDash>(['solid', 'dashed', 'dotted']);
const CANVAS_TEXT_ALIGNS = new Set<UserIndicatorCanvasTextAlign>(['left', 'center', 'right']);
const PANEL_POSITIONS = new Set<UserIndicatorPanelPosition>([
  'top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-right',
]);
const PANEL_ALIGNS = new Set<UserIndicatorPanelAlign>(['left', 'center', 'right']);
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SERIES_OPTION_KEYS = new Set(['color', 'lineWidth', 'priceLineVisible', 'lastValueVisible', 'visible']);
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

type CallbackBudget = {
  markerCount: number;
  canvasCommandCount: number;
  textBytes: number;
  logCount: number;
  logBytes: number;
};

function fail(message: string): never {
  throw new UserIndicatorOutputError('invalid_output', message);
}

function limit(message: string): never {
  throw new UserIndicatorOutputError('output_limit_exceeded', message);
}

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value: unknown, field: string): UnknownRecord {
  if (!isRecord(value)) fail(`${field} must be an object`);
  return value;
}

function allowedKeys(value: UnknownRecord, allowed: ReadonlySet<string>, field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${field} contains unsupported field ${JSON.stringify(key)}`);
  }
}

function finite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} must be a finite number`);
  return value;
}

function integer(value: unknown, field: string): number {
  const numberValue = finite(value, field);
  if (!Number.isInteger(numberValue)) fail(`${field} must be an integer`);
  return numberValue;
}

function resourceKey(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > USER_INDICATOR_RUNTIME_LIMITS.resourceKeyChars
    || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)
    || RESERVED_KEYS.has(value)) {
    fail(`${field} is not a valid resource key`);
  }
  return value;
}

function color(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) fail(`${field} must be a hexadecimal color`);
  return value;
}

function textField(value: unknown, field: string, budget: CallbackBudget): string {
  if (typeof value !== 'string') fail(`${field} must be a string`);
  if (value.length > USER_INDICATOR_RUNTIME_LIMITS.textFieldChars) {
    limit(`${field} exceeds ${USER_INDICATOR_RUNTIME_LIMITS.textFieldChars} characters`);
  }
  budget.textBytes += new TextEncoder().encode(value).byteLength;
  if (budget.textBytes > USER_INDICATOR_RUNTIME_LIMITS.callbackTextBytes) {
    limit(`callback text exceeds ${USER_INDICATOR_RUNTIME_LIMITS.callbackTextBytes} bytes`);
  }
  return value;
}

function validatePanelContent(
  value: unknown,
  field: string,
  budget: CallbackBudget,
): UserIndicatorPanelContent {
  const panel = record(value, field);
  allowedKeys(panel, new Set(['title', 'columns', 'rows']), field);
  if (!Array.isArray(panel.columns) || panel.columns.length === 0) {
    fail(`${field}.columns must be a non-empty array`);
  }
  if (!Array.isArray(panel.rows)) fail(`${field}.rows must be an array`);
  if (panel.rows.length > USER_INDICATOR_RUNTIME_LIMITS.panelRows) {
    limit(`${field}.rows exceeds ${USER_INDICATOR_RUNTIME_LIMITS.panelRows}`);
  }

  const seenColumns = new Set<string>();
  const columns = Object.freeze(panel.columns.map((columnValue, index) => {
    const columnField = `${field}.columns[${index}]`;
    const column = record(columnValue, columnField);
    allowedKeys(column, new Set(['key', 'title', 'align']), columnField);
    const key = resourceKey(column.key, `${columnField}.key`);
    if (seenColumns.has(key)) fail(`${field}.columns contains duplicate key ${JSON.stringify(key)}`);
    seenColumns.add(key);
    let align: UserIndicatorPanelAlign | undefined;
    if (column.align !== undefined) {
      if (typeof column.align !== 'string' || !PANEL_ALIGNS.has(column.align as UserIndicatorPanelAlign)) {
        fail(`${columnField}.align is unsupported`);
      }
      align = column.align as UserIndicatorPanelAlign;
    }
    return Object.freeze({
      key,
      title: textField(column.title, `${columnField}.title`, budget),
      ...(align === undefined ? {} : { align }),
    });
  }));

  let cells = 0;
  const rows = Object.freeze(panel.rows.map((rowValue, rowIndex) => {
    const rowField = `${field}.rows[${rowIndex}]`;
    const row = record(rowValue, rowField);
    allowedKeys(row, new Set(['cells']), rowField);
    if (!Array.isArray(row.cells) || row.cells.length !== columns.length) {
      fail(`${rowField}.cells must contain exactly ${columns.length} entries`);
    }
    cells += row.cells.length;
    if (cells > USER_INDICATOR_RUNTIME_LIMITS.panelCells) {
      limit(`${field} exceeds ${USER_INDICATOR_RUNTIME_LIMITS.panelCells} table cells`);
    }
    const rowCells = Object.freeze(row.cells.map((cellValue, cellIndex) => {
      const cellField = `${rowField}.cells[${cellIndex}]`;
      const cell = record(cellValue, cellField);
      allowedKeys(cell, new Set(['text', 'color']), cellField);
      return Object.freeze({
        text: textField(cell.text, `${cellField}.text`, budget),
        ...(cell.color === undefined ? {} : { color: color(cell.color, `${cellField}.color`) }),
      });
    }));
    return Object.freeze({ cells: rowCells });
  }));

  if (cells > USER_INDICATOR_RUNTIME_LIMITS.panelCells) {
    limit(`${field} exceeds ${USER_INDICATOR_RUNTIME_LIMITS.panelCells} table cells`);
  }
  return Object.freeze({
    ...(panel.title === undefined ? {} : { title: textField(panel.title, `${field}.title`, budget) }),
    columns,
    rows,
  });
}

function validateMarker(value: unknown, field: string, budget: CallbackBudget): UserIndicatorMarker {
  const marker = record(value, field);
  allowedKeys(
    marker,
    new Set(['time', 'position', 'shape', 'color', 'price', 'id', 'text', 'textColor', 'tooltip', 'size', 'hitTest']),
    field,
  );
  const time = integer(marker.time, `${field}.time`);
  if (typeof marker.position !== 'string'
    || (!MARKER_BAR_POSITIONS.has(marker.position as UserIndicatorMarkerBarPosition)
      && !MARKER_PRICE_POSITIONS.has(marker.position as UserIndicatorMarkerPricePosition))) {
    fail(`${field}.position is unsupported`);
  }
  if (typeof marker.shape !== 'string' || !MARKER_SHAPES.has(marker.shape as UserIndicatorMarkerShape)) {
    fail(`${field}.shape is unsupported`);
  }
  const position = marker.position as UserIndicatorMarkerPosition;
  let price: number | undefined;
  if (marker.price !== undefined) price = finite(marker.price, `${field}.price`);
  if (MARKER_PRICE_POSITIONS.has(position as UserIndicatorMarkerPricePosition) && price === undefined) {
    fail(`${field}.price is required for ${position}`);
  }
  let size: number | undefined;
  if (marker.size !== undefined) {
    size = finite(marker.size, `${field}.size`);
    if (size <= 0) fail(`${field}.size must be positive`);
  }
  if (marker.hitTest !== undefined && typeof marker.hitTest !== 'boolean') fail(`${field}.hitTest must be boolean`);
  if (marker.hitTest === true && marker.id === undefined) fail(`${field}.id is required when hitTest=true`);
  return Object.freeze({
    time,
    position,
    shape: marker.shape as UserIndicatorMarkerShape,
    color: color(marker.color, `${field}.color`),
    ...(price === undefined ? {} : { price }),
    ...(marker.id === undefined ? {} : { id: textField(marker.id, `${field}.id`, budget) }),
    ...(marker.text === undefined ? {} : { text: textField(marker.text, `${field}.text`, budget) }),
    ...(marker.textColor === undefined ? {} : { textColor: color(marker.textColor, `${field}.textColor`) }),
    ...(marker.tooltip === undefined ? {} : { tooltip: textField(marker.tooltip, `${field}.tooltip`, budget) }),
    ...(size === undefined ? {} : { size }),
    ...(marker.hitTest === undefined ? {} : { hitTest: marker.hitTest }),
  });
}

function validateBarStyle(value: unknown, field: string): UserIndicatorBarStyle {
  const style = record(value, field);
  allowedKeys(style, new Set(['time', 'color', 'borderColor', 'wickColor']), field);
  return Object.freeze({
    time: integer(style.time, `${field}.time`),
    ...(style.color === undefined ? {} : { color: color(style.color, `${field}.color`) }),
    ...(style.borderColor === undefined ? {} : { borderColor: color(style.borderColor, `${field}.borderColor`) }),
    ...(style.wickColor === undefined ? {} : { wickColor: color(style.wickColor, `${field}.wickColor`) }),
  });
}

function validateBarStyleChartKinds(value: unknown, field: string): readonly UserIndicatorBarStyleChartKind[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > BAR_STYLE_CHART_KINDS.size) {
    fail(`${field} must be a non-empty chart kind array`);
  }
  const seen = new Set<UserIndicatorBarStyleChartKind>();
  const chartKinds = value.map((entry, index) => {
    if (typeof entry !== 'string' || !BAR_STYLE_CHART_KINDS.has(entry as UserIndicatorBarStyleChartKind)) {
      fail(`${field}[${index}] is unsupported`);
    }
    const chartKind = entry as UserIndicatorBarStyleChartKind;
    if (seen.has(chartKind)) fail(`${field} contains duplicate chart kind ${JSON.stringify(chartKind)}`);
    seen.add(chartKind);
    return chartKind;
  });
  return Object.freeze(chartKinds);
}

function canvasLineWidth(value: unknown, field: string): number {
  const width = finite(value, field);
  if (width <= 0 || width > USER_INDICATOR_RUNTIME_LIMITS.canvasLineWidthMax) {
    fail(`${field} must be > 0 and <= ${USER_INDICATOR_RUNTIME_LIMITS.canvasLineWidthMax}`);
  }
  return width;
}

function canvasPixel(value: unknown, field: string): number {
  const pixel = finite(value, field);
  if (Math.abs(pixel) > USER_INDICATOR_RUNTIME_LIMITS.canvasPixelMagnitudeMax) {
    fail(`${field} exceeds the supported pixel magnitude`);
  }
  return pixel;
}

function validateCanvasPoint(
  value: unknown,
  field: string,
  allowPrice: boolean,
): UserIndicatorCanvasPoint {
  const point = record(value, field);
  if (point.space === 'time-price') {
    allowedKeys(point, new Set(['space', 'time', 'price']), field);
    if (!allowPrice) fail(`${field} cannot use time-price coordinates on a pane canvas target`);
    return Object.freeze({
      space: 'time-price',
      time: integer(point.time, `${field}.time`),
      price: finite(point.price, `${field}.price`),
    });
  }
  if (point.space === 'time-pixel') {
    allowedKeys(point, new Set(['space', 'time', 'y']), field);
    return Object.freeze({
      space: 'time-pixel',
      time: integer(point.time, `${field}.time`),
      y: canvasPixel(point.y, `${field}.y`),
    });
  }
  if (point.space === 'pane-pixel') {
    allowedKeys(point, new Set(['space', 'x', 'y']), field);
    return Object.freeze({
      space: 'pane-pixel',
      x: canvasPixel(point.x, `${field}.x`),
      y: canvasPixel(point.y, `${field}.y`),
    });
  }
  fail(`${field}.space is unsupported`);
}

function validateCanvasTarget(
  value: unknown,
  panes: ReadonlySet<string>,
  series: ReadonlyMap<string, SeriesResource>,
  field: string,
): UserIndicatorCanvasTarget {
  const target = record(value, field);
  if (target.type === 'current-main-series') {
    allowedKeys(target, new Set(['type']), field);
    return Object.freeze({ type: 'current-main-series' });
  }
  if (target.type === 'pane') {
    allowedKeys(target, new Set(['type', 'pane']), field);
    if (typeof target.pane !== 'string' || !panes.has(target.pane)) fail(`${field}.pane does not exist`);
    return Object.freeze({ type: 'pane', pane: target.pane });
  }
  if (target.type === 'series') {
    allowedKeys(target, new Set(['type', 'series']), field);
    if (typeof target.series !== 'string' || !series.has(target.series)) fail(`${field}.series does not exist`);
    return Object.freeze({ type: 'series', series: target.series });
  }
  fail(`${field}.type is unsupported`);
}

function validateCanvasDash(value: unknown, field: string): UserIndicatorCanvasDash | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !CANVAS_DASHES.has(value as UserIndicatorCanvasDash)) {
    fail(`${field} is unsupported`);
  }
  return value as UserIndicatorCanvasDash;
}

function requireSameCanvasSpace(points: readonly UserIndicatorCanvasPoint[], field: string): void {
  if (points.length === 0) return;
  const space = points[0].space;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].space !== space) fail(`${field} must use one coordinate space per command`);
  }
}

function validateCanvasCommands(
  value: unknown,
  resource: CanvasResource,
  field: string,
  budget: CallbackBudget,
): readonly UserIndicatorCanvasCommand[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  budget.canvasCommandCount += value.length;
  if (budget.canvasCommandCount > USER_INDICATOR_RUNTIME_LIMITS.canvasCommandsPerCallback) {
    limit(`callback canvas commands exceeds ${USER_INDICATOR_RUNTIME_LIMITS.canvasCommandsPerCallback}`);
  }
  const allowPrice = resource.target.type !== 'pane';
  return Object.freeze(value.map((entry, index) => {
    const commandField = `${field}[${index}]`;
    const command = record(entry, commandField);
    if (typeof command.type !== 'string') fail(`${commandField}.type must be a string`);

    const interaction = (allowed: ReadonlySet<string>) => {
      allowedKeys(command, new Set([...allowed, 'id', 'hitTest']), commandField);
      if (command.hitTest !== undefined && typeof command.hitTest !== 'boolean') fail(`${commandField}.hitTest must be boolean`);
      if (command.hitTest === true && command.id === undefined) fail(`${commandField}.id is required when hitTest=true`);
      if (command.hitTest === true && resource.target.type !== 'current-main-series') {
        fail(`${commandField}.hitTest is currently supported only on current-main-series canvas layers`);
      }
      return {
        ...(command.id === undefined ? {} : { id: textField(command.id, `${commandField}.id`, budget) }),
        ...(command.hitTest === undefined ? {} : { hitTest: command.hitTest }),
      };
    };

    const commonStroke = (allowed: ReadonlySet<string>) => {
      const interactive = interaction(allowed);
      const lineWidth = command.lineWidth === undefined
        ? undefined
        : canvasLineWidth(command.lineWidth, `${commandField}.lineWidth`);
      const dash = validateCanvasDash(command.dash, `${commandField}.dash`);
      return { lineWidth, dash, interactive };
    };

    if (command.type === 'line') {
      const { lineWidth, dash, interactive } = commonStroke(new Set(['type', 'from', 'to', 'color', 'lineWidth', 'dash']));
      const from = validateCanvasPoint(command.from, `${commandField}.from`, allowPrice);
      const to = validateCanvasPoint(command.to, `${commandField}.to`, allowPrice);
      requireSameCanvasSpace([from, to], commandField);
      return Object.freeze({
        type: 'line' as const,
        from,
        to,
        color: color(command.color, `${commandField}.color`),
        ...interactive,
        ...(lineWidth === undefined ? {} : { lineWidth }),
        ...(dash === undefined ? {} : { dash }),
      });
    }

    if (command.type === 'polyline' || command.type === 'polygon') {
      const allowed = command.type === 'polyline'
        ? new Set(['type', 'points', 'color', 'lineWidth', 'dash'])
        : new Set(['type', 'points', 'fillColor', 'borderColor', 'lineWidth', 'dash']);
      const { lineWidth, dash, interactive } = commonStroke(allowed);
      if (!Array.isArray(command.points)) fail(`${commandField}.points must be an array`);
      const minimum = command.type === 'polyline' ? 2 : 3;
      if (command.points.length < minimum) fail(`${commandField}.points requires at least ${minimum} points`);
      if (command.points.length > USER_INDICATOR_RUNTIME_LIMITS.canvasPointsPerCommand) {
        limit(`${commandField}.points exceeds ${USER_INDICATOR_RUNTIME_LIMITS.canvasPointsPerCommand}`);
      }
      const points = Object.freeze(command.points.map((point, pointIndex) => validateCanvasPoint(
        point,
        `${commandField}.points[${pointIndex}]`,
        allowPrice,
      )));
      requireSameCanvasSpace(points, `${commandField}.points`);
      if (command.type === 'polyline') {
        return Object.freeze({
          type: 'polyline' as const,
          points,
          color: color(command.color, `${commandField}.color`),
          ...interactive,
          ...(lineWidth === undefined ? {} : { lineWidth }),
          ...(dash === undefined ? {} : { dash }),
        });
      }
      if (command.fillColor === undefined && command.borderColor === undefined) {
        fail(`${commandField} requires fillColor or borderColor`);
      }
      return Object.freeze({
        type: 'polygon' as const,
        points,
        ...interactive,
        ...(command.fillColor === undefined ? {} : { fillColor: color(command.fillColor, `${commandField}.fillColor`) }),
        ...(command.borderColor === undefined ? {} : { borderColor: color(command.borderColor, `${commandField}.borderColor`) }),
        ...(lineWidth === undefined ? {} : { lineWidth }),
        ...(dash === undefined ? {} : { dash }),
      });
    }

    if (command.type === 'rect') {
      const { lineWidth, dash, interactive } = commonStroke(new Set([
        'type', 'from', 'to', 'fillColor', 'borderColor', 'lineWidth', 'dash',
      ]));
      if (command.fillColor === undefined && command.borderColor === undefined) {
        fail(`${commandField} requires fillColor or borderColor`);
      }
      const from = validateCanvasPoint(command.from, `${commandField}.from`, allowPrice);
      const to = validateCanvasPoint(command.to, `${commandField}.to`, allowPrice);
      requireSameCanvasSpace([from, to], commandField);
      return Object.freeze({
        type: 'rect' as const,
        from,
        to,
        ...interactive,
        ...(command.fillColor === undefined ? {} : { fillColor: color(command.fillColor, `${commandField}.fillColor`) }),
        ...(command.borderColor === undefined ? {} : { borderColor: color(command.borderColor, `${commandField}.borderColor`) }),
        ...(lineWidth === undefined ? {} : { lineWidth }),
        ...(dash === undefined ? {} : { dash }),
      });
    }

    if (command.type === 'circle') {
      const { lineWidth, dash, interactive } = commonStroke(new Set([
        'type', 'at', 'radius', 'fillColor', 'borderColor', 'lineWidth', 'dash',
      ]));
      if (command.fillColor === undefined && command.borderColor === undefined) {
        fail(`${commandField} requires fillColor or borderColor`);
      }
      const radius = finite(command.radius, `${commandField}.radius`);
      if (radius <= 0 || radius > USER_INDICATOR_RUNTIME_LIMITS.canvasRadiusMax) {
        fail(`${commandField}.radius is outside the supported range`);
      }
      return Object.freeze({
        type: 'circle' as const,
        at: validateCanvasPoint(command.at, `${commandField}.at`, allowPrice),
        radius,
        ...interactive,
        ...(command.fillColor === undefined ? {} : { fillColor: color(command.fillColor, `${commandField}.fillColor`) }),
        ...(command.borderColor === undefined ? {} : { borderColor: color(command.borderColor, `${commandField}.borderColor`) }),
        ...(lineWidth === undefined ? {} : { lineWidth }),
        ...(dash === undefined ? {} : { dash }),
      });
    }

    if (command.type === 'text') {
      const interactive = interaction(new Set(['type', 'at', 'text', 'color', 'fontSize', 'align']));
      const fontSize = finite(command.fontSize, `${commandField}.fontSize`);
      if (fontSize < USER_INDICATOR_RUNTIME_LIMITS.canvasFontSizeMin
        || fontSize > USER_INDICATOR_RUNTIME_LIMITS.canvasFontSizeMax) {
        fail(`${commandField}.fontSize is outside the supported range`);
      }
      let align: UserIndicatorCanvasTextAlign | undefined;
      if (command.align !== undefined) {
        if (typeof command.align !== 'string' || !CANVAS_TEXT_ALIGNS.has(command.align as UserIndicatorCanvasTextAlign)) {
          fail(`${commandField}.align is unsupported`);
        }
        align = command.align as UserIndicatorCanvasTextAlign;
      }
      return Object.freeze({
        type: 'text' as const,
        at: validateCanvasPoint(command.at, `${commandField}.at`, allowPrice),
        text: textField(command.text, `${commandField}.text`, budget),
        color: color(command.color, `${commandField}.color`),
        fontSize,
        ...interactive,
        ...(align === undefined ? {} : { align }),
      });
    }

    fail(`${commandField}.type ${JSON.stringify(command.type)} is unsupported`);
  }));
}

function validateSeriesOptions(value: unknown, field: string): UserIndicatorSeriesOptions | undefined {
  if (value === undefined) return undefined;
  const options = record(value, field);
  allowedKeys(options, SERIES_OPTION_KEYS, field);
  const validated: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (options.color !== undefined) validated.color = color(options.color, `${field}.color`);
  if (options.lineWidth !== undefined) {
    const width = integer(options.lineWidth, `${field}.lineWidth`);
    if (width < 1 || width > USER_INDICATOR_RUNTIME_LIMITS.seriesLineWidthMax) {
      fail(`${field}.lineWidth must be 1-${USER_INDICATOR_RUNTIME_LIMITS.seriesLineWidthMax}`);
    }
    validated.lineWidth = width;
  }
  for (const key of ['priceLineVisible', 'lastValueVisible', 'visible'] as const) {
    if (options[key] !== undefined) {
      if (typeof options[key] !== 'boolean') fail(`${field}.${key} must be boolean`);
      validated[key] = options[key];
    }
  }
  return Object.freeze(validated) as UserIndicatorSeriesOptions;
}

function validatePoint(
  value: unknown,
  seriesType: UserIndicatorSeriesType,
  field: string,
): UserIndicatorSeriesPoint {
  const point = record(value, field);
  if (seriesType === 'bar') {
    allowedKeys(point, new Set(['time', 'open', 'high', 'low', 'close', 'color']), field);
    const validated: UserIndicatorBarPoint = Object.freeze({
      time: integer(point.time, `${field}.time`),
      open: finite(point.open, `${field}.open`),
      high: finite(point.high, `${field}.high`),
      low: finite(point.low, `${field}.low`),
      close: finite(point.close, `${field}.close`),
      ...(point.color === undefined ? {} : { color: color(point.color, `${field}.color`) }),
    });
    return validated;
  }

  allowedKeys(point, new Set(['time', 'value', 'color']), field);
  const validated: UserIndicatorValuePoint = Object.freeze({
    time: integer(point.time, `${field}.time`),
    ...(point.value === undefined ? {} : { value: finite(point.value, `${field}.value`) }),
    ...(point.color === undefined ? {} : { color: color(point.color, `${field}.color`) }),
  });
  return validated;
}

function validateCommand(
  value: unknown,
  callback: UserIndicatorCallbackOutput['phase'],
  barsLength: number | null,
  panes: Set<string>,
  series: Map<string, SeriesResource>,
  markers: Set<string>,
  barStyles: Set<string>,
  canvases: Map<string, CanvasResource>,
  panels: Map<string, PanelResource>,
  budget: CallbackBudget,
  field: string,
): UserIndicatorOutputCommand {
  const command = record(value, field);
  if (typeof command.type !== 'string') fail(`${field}.type must be a string`);

  if (command.type === 'create-pane') {
    allowedKeys(command, new Set(['type', 'key', 'defaultHeight']), field);
    if (callback !== 'create') fail('panes may only be created during create()');
    if (panes.size - 1 >= USER_INDICATOR_RUNTIME_LIMITS.panes) limit(`pane limit ${USER_INDICATOR_RUNTIME_LIMITS.panes} exceeded`);
    const key = resourceKey(command.key, `${field}.key`);
    if (key === 'main' || panes.has(key)) fail(`duplicate or reserved pane key ${JSON.stringify(key)}`);
    const defaultHeight = integer(command.defaultHeight, `${field}.defaultHeight`);
    if (defaultHeight < USER_INDICATOR_RUNTIME_LIMITS.paneMinHeight
      || defaultHeight > USER_INDICATOR_RUNTIME_LIMITS.paneMaxHeight) {
      fail(`${field}.defaultHeight is outside the supported range`);
    }
    panes.add(key);
    return Object.freeze({ type: 'create-pane', key, defaultHeight });
  }

  if (command.type === 'create-series') {
    allowedKeys(command, new Set(['type', 'key', 'seriesType', 'pane', 'options']), field);
    if (callback !== 'create') fail('series may only be created during create()');
    if (series.size >= USER_INDICATOR_RUNTIME_LIMITS.series) limit(`series limit ${USER_INDICATOR_RUNTIME_LIMITS.series} exceeded`);
    const key = resourceKey(command.key, `${field}.key`);
    if (series.has(key)) fail(`duplicate series key ${JSON.stringify(key)}`);
    if (typeof command.seriesType !== 'string' || !SERIES_TYPES.has(command.seriesType as UserIndicatorSeriesType)) {
      fail(`${field}.seriesType is unsupported`);
    }
    if (typeof command.pane !== 'string' || !panes.has(command.pane)) fail(`${field}.pane does not exist`);
    const seriesType = command.seriesType as UserIndicatorSeriesType;
    const options = validateSeriesOptions(command.options, `${field}.options`);
    series.set(key, Object.freeze({ type: seriesType, pane: command.pane }));
    return Object.freeze({
      type: 'create-series',
      key,
      seriesType,
      pane: command.pane,
      ...(options === undefined ? {} : { options }),
    });
  }

  if (command.type === 'series-set-visible') {
    allowedKeys(command, new Set(['type', 'key', 'visible']), field);
    const key = resourceKey(command.key, `${field}.key`);
    if (!series.has(key)) fail(`${field}.key references an unknown series`);
    if (typeof command.visible !== 'boolean') fail(`${field}.visible must be boolean`);
    return Object.freeze({ type: 'series-set-visible', key, visible: command.visible });
  }

  if (command.type === 'debug-log') {
    allowedKeys(command, new Set(['type', 'message']), field);
    budget.logCount += 1;
    if (budget.logCount > USER_INDICATOR_RUNTIME_LIMITS.consoleEntriesPerCallback) {
      limit(`callback debug logs exceeds ${USER_INDICATOR_RUNTIME_LIMITS.consoleEntriesPerCallback}`);
    }
    const message = textField(command.message, `${field}.message`, budget);
    budget.logBytes += new TextEncoder().encode(message).byteLength;
    if (budget.logBytes > USER_INDICATOR_RUNTIME_LIMITS.consoleBytesPerCallback) {
      limit(`callback debug logs exceeds ${USER_INDICATOR_RUNTIME_LIMITS.consoleBytesPerCallback} bytes`);
    }
    return Object.freeze({ type: 'debug-log', message });
  }

  if (command.type === 'create-marker-contribution') {
    allowedKeys(command, new Set(['type', 'key', 'priority']), field);
    if (callback !== 'create') fail('marker contributions may only be created during create()');
    const key = resourceKey(command.key, `${field}.key`);
    if (markers.has(key)) fail(`duplicate marker contribution key ${JSON.stringify(key)}`);
    const priority = integer(command.priority, `${field}.priority`);
    markers.add(key);
    return Object.freeze({ type: 'create-marker-contribution', key, priority });
  }

  if (command.type === 'marker-set') {
    allowedKeys(command, new Set(['type', 'key', 'markers']), field);
    if (callback !== 'update' && callback !== 'pointer') fail('marker values may only be set during update()/onPointer()');
    const key = resourceKey(command.key, `${field}.key`);
    if (!markers.has(key)) fail(`${field}.key references an unknown marker contribution`);
    if (!Array.isArray(command.markers)) fail(`${field}.markers must be an array`);
    budget.markerCount += command.markers.length;
    if (budget.markerCount > USER_INDICATOR_RUNTIME_LIMITS.markersPerCallback) {
      limit(`callback markers exceeds ${USER_INDICATOR_RUNTIME_LIMITS.markersPerCallback}`);
    }
    const validatedMarkers = Object.freeze(command.markers.map((marker, index) => validateMarker(
      marker,
      `${field}.markers[${index}]`,
      budget,
    )));
    return Object.freeze({ type: 'marker-set', key, markers: validatedMarkers });
  }

  if (command.type === 'create-bar-style-contribution') {
    allowedKeys(command, new Set(['type', 'key', 'priority', 'chartKinds']), field);
    if (callback !== 'create') fail('bar style contributions may only be created during create()');
    const key = resourceKey(command.key, `${field}.key`);
    if (barStyles.has(key)) fail(`duplicate bar style contribution key ${JSON.stringify(key)}`);
    const priority = integer(command.priority, `${field}.priority`);
    const chartKinds = validateBarStyleChartKinds(command.chartKinds, `${field}.chartKinds`);
    barStyles.add(key);
    return Object.freeze({ type: 'create-bar-style-contribution', key, priority, chartKinds });
  }

  if (command.type === 'bar-style-set') {
    allowedKeys(command, new Set(['type', 'key', 'styles']), field);
    if (callback !== 'update' || barsLength === null) fail('bar styles may only be set during update()');
    const key = resourceKey(command.key, `${field}.key`);
    if (!barStyles.has(key)) fail(`${field}.key references an unknown bar style contribution`);
    if (!Array.isArray(command.styles)) fail(`${field}.styles must be an array`);
    if (command.styles.length > barsLength) limit(`${field}.styles exceeds current bars length ${barsLength}`);
    let previousTime = Number.NEGATIVE_INFINITY;
    const styles = Object.freeze(command.styles.map((style, index) => {
      const validated = validateBarStyle(style, `${field}.styles[${index}]`);
      if (validated.time <= previousTime) fail(`${field}.styles must be strictly increasing by time`);
      previousTime = validated.time;
      return validated;
    }));
    return Object.freeze({ type: 'bar-style-set', key, styles });
  }

  if (command.type === 'create-canvas-layer') {
    allowedKeys(command, new Set(['type', 'key', 'target', 'zOrder']), field);
    if (callback !== 'create') fail('canvas layers may only be created during create()');
    if (canvases.size >= USER_INDICATOR_RUNTIME_LIMITS.canvasLayers) {
      limit(`canvas layer limit ${USER_INDICATOR_RUNTIME_LIMITS.canvasLayers} exceeded`);
    }
    const key = resourceKey(command.key, `${field}.key`);
    if (canvases.has(key)) fail(`duplicate canvas layer key ${JSON.stringify(key)}`);
    const target = validateCanvasTarget(command.target, panes, series, `${field}.target`);
    const zOrder = command.zOrder === undefined ? 'normal' : command.zOrder;
    if (typeof zOrder !== 'string' || !CANVAS_Z_ORDERS.has(zOrder as UserIndicatorCanvasZOrder)) {
      fail(`${field}.zOrder is unsupported`);
    }
    canvases.set(key, Object.freeze({ target }));
    return Object.freeze({
      type: 'create-canvas-layer',
      key,
      target,
      zOrder: zOrder as UserIndicatorCanvasZOrder,
    });
  }

  if (command.type === 'canvas-set-commands') {
    allowedKeys(command, new Set(['type', 'key', 'commands']), field);
    if (callback !== 'update' && callback !== 'pointer') fail('canvas commands may only be set during update()/onPointer()');
    const key = resourceKey(command.key, `${field}.key`);
    const resource = canvases.get(key);
    if (!resource) fail(`${field}.key references an unknown canvas layer`);
    return Object.freeze({
      type: 'canvas-set-commands',
      key,
      commands: validateCanvasCommands(command.commands, resource, `${field}.commands`, budget),
    });
  }

  if (command.type === 'canvas-set-visible') {
    allowedKeys(command, new Set(['type', 'key', 'visible']), field);
    const key = resourceKey(command.key, `${field}.key`);
    if (!canvases.has(key)) fail(`${field}.key references an unknown canvas layer`);
    if (typeof command.visible !== 'boolean') fail(`${field}.visible must be boolean`);
    return Object.freeze({ type: 'canvas-set-visible', key, visible: command.visible });
  }

  if (command.type === 'create-panel') {
    allowedKeys(command, new Set(['type', 'key', 'paneKey', 'position']), field);
    if (callback !== 'create') fail('panels may only be created during create()');
    if (panels.size >= USER_INDICATOR_RUNTIME_LIMITS.panels) {
      limit(`panel limit ${USER_INDICATOR_RUNTIME_LIMITS.panels} exceeded`);
    }
    const key = resourceKey(command.key, `${field}.key`);
    if (panels.has(key)) fail(`duplicate panel key ${JSON.stringify(key)}`);
    if (typeof command.paneKey !== 'string' || !panes.has(command.paneKey)) {
      fail(`${field}.paneKey references an unknown pane`);
    }
    if (typeof command.position !== 'string'
      || !PANEL_POSITIONS.has(command.position as UserIndicatorPanelPosition)) {
      fail(`${field}.position is unsupported`);
    }
    const position = command.position as UserIndicatorPanelPosition;
    panels.set(key, Object.freeze({ paneKey: command.paneKey, position }));
    return Object.freeze({ type: 'create-panel', key, paneKey: command.paneKey, position });
  }

  if (command.type === 'panel-set') {
    allowedKeys(command, new Set(['type', 'key', 'content']), field);
    if (callback !== 'update' && callback !== 'pointer') fail('panel content may only be set during update()/onPointer()');
    const key = resourceKey(command.key, `${field}.key`);
    if (!panels.has(key)) fail(`${field}.key references an unknown panel`);
    return Object.freeze({
      type: 'panel-set',
      key,
      content: validatePanelContent(command.content, `${field}.content`, budget),
    });
  }

  if ((callback !== 'update' && callback !== 'pointer') || barsLength === null) {
    fail(`${command.type} is only allowed during update()/onPointer()`);
  }
  const key = resourceKey(command.key, `${field}.key`);
  const resource = series.get(key);
  if (!resource) fail(`${field}.key references an unknown series`);

  if (command.type === 'series-set-values') {
    allowedKeys(command, new Set(['type', 'key', 'values', 'dirtyFrom']), field);
    if (resource.type === 'bar') fail('series-set-values is not supported for bar series');
    if (!Array.isArray(command.values) || command.values.length !== barsLength) {
      fail(`${field}.values must contain exactly ${barsLength} entries`);
    }
    const values = Object.freeze(command.values.map((entry, index) => {
      if (entry === null) return null;
      return finite(entry, `${field}.values[${index}]`);
    }));
    let dirtyFrom: number | undefined;
    if (command.dirtyFrom !== undefined) {
      dirtyFrom = integer(command.dirtyFrom, `${field}.dirtyFrom`);
      if (dirtyFrom < 0 || dirtyFrom > barsLength) fail(`${field}.dirtyFrom is outside the bars range`);
    }
    return Object.freeze({ type: 'series-set-values', key, values, ...(dirtyFrom === undefined ? {} : { dirtyFrom }) });
  }

  if (command.type === 'series-set-data') {
    allowedKeys(command, new Set(['type', 'key', 'points']), field);
    if (!Array.isArray(command.points)) fail(`${field}.points must be an array`);
    if (command.points.length > USER_INDICATOR_RUNTIME_LIMITS.seriesDataPointsPerCallback) {
      limit(`${field}.points exceeds ${USER_INDICATOR_RUNTIME_LIMITS.seriesDataPointsPerCallback}`);
    }
    let previousTime = Number.NEGATIVE_INFINITY;
    const points = Object.freeze(command.points.map((point, index) => {
      const validated = validatePoint(point, resource.type, `${field}.points[${index}]`);
      if (validated.time <= previousTime) fail(`${field}.points must be strictly increasing by time`);
      previousTime = validated.time;
      return validated;
    }));
    return Object.freeze({ type: 'series-set-data', key, points });
  }

  if (command.type === 'series-update') {
    allowedKeys(command, new Set(['type', 'key', 'point']), field);
    return Object.freeze({ type: 'series-update', key, point: validatePoint(command.point, resource.type, `${field}.point`) });
  }

  fail(`${field}.type ${JSON.stringify(command.type)} is unsupported`);
}

function outputByteLimit(expectation: UserIndicatorOutputExpectation): number {
  if (expectation.type === 'pointer') return USER_INDICATOR_RUNTIME_LIMITS.realtimeOutputBytes;
  return expectation.reason === 'realtime'
    ? USER_INDICATOR_RUNTIME_LIMITS.realtimeOutputBytes
    : USER_INDICATOR_RUNTIME_LIMITS.bulkOutputBytes;
}

function validateCallback(
  value: unknown,
  expectedPhase: UserIndicatorCallbackOutput['phase'],
  expectation: UserIndicatorOutputExpectation,
  panes: Set<string>,
  series: Map<string, SeriesResource>,
  markers: Set<string>,
  barStyles: Set<string>,
  canvases: Map<string, CanvasResource>,
  panels: Map<string, PanelResource>,
  field: string,
): UserIndicatorCallbackOutput {
  const callback = record(value, field);
  const allowed = expectedPhase === 'create'
    ? new Set(['phase', 'commands'])
    : expectedPhase === 'pointer'
      ? new Set(['phase', 'pointerType', 'id', 'time', 'price', 'pane', 'commands'])
      : new Set(['phase', 'reason', 'changedFrom', 'barsLength', 'commands']);
  allowedKeys(callback, allowed, field);
  if (callback.phase !== expectedPhase) fail(`${field}.phase does not match the request`);
  if (!Array.isArray(callback.commands)) fail(`${field}.commands must be an array`);
  if (callback.commands.length > USER_INDICATOR_RUNTIME_LIMITS.outboxCommandsPerCallback) {
    limit(`${field}.commands exceeds ${USER_INDICATOR_RUNTIME_LIMITS.outboxCommandsPerCallback}`);
  }

  let barsLength: number | null = null;
  if (expectedPhase === 'update') {
    if (expectation.type === 'pointer') fail(`${field} received update output for pointer request`);
    if (callback.reason !== expectation.reason) fail(`${field}.reason does not match the dispatched event`);
    if (callback.changedFrom !== expectation.changedFrom) fail(`${field}.changedFrom does not match the dispatched event`);
    if (callback.barsLength !== expectation.barsLength) fail(`${field}.barsLength does not match the dispatched event`);
    barsLength = expectation.barsLength;
  } else if (expectedPhase === 'pointer') {
    if (expectation.type !== 'pointer') fail(`${field} received pointer output for non-pointer request`);
    if (callback.pointerType !== expectation.pointerType) fail(`${field}.pointerType does not match the dispatched event`);
    if (callback.id !== expectation.id) fail(`${field}.id does not match the dispatched event`);
    if (callback.time !== expectation.time) fail(`${field}.time does not match the dispatched event`);
    if (callback.price !== expectation.price) fail(`${field}.price does not match the dispatched event`);
    if (callback.pane !== expectation.pane) fail(`${field}.pane does not match the dispatched event`);
    barsLength = expectation.barsLength;
  }

  const budget: CallbackBudget = { markerCount: 0, canvasCommandCount: 0, textBytes: 0, logCount: 0, logBytes: 0 };
  const commands = Object.freeze(callback.commands.map((command, index) => validateCommand(
    command,
    expectedPhase,
    barsLength,
    panes,
    series,
    markers,
    barStyles,
    canvases,
    panels,
    budget,
    `${field}.commands[${index}]`,
  )));
  if (expectedPhase === 'create') return Object.freeze({ phase: 'create', commands });
  if (expectedPhase === 'pointer') {
    if (expectation.type !== 'pointer') fail(`${field} pointer expectation is missing`);
    return Object.freeze({
      phase: 'pointer',
      pointerType: expectation.pointerType,
      id: expectation.id,
      time: expectation.time,
      price: expectation.price,
      pane: expectation.pane,
      commands,
    });
  }
  if (expectation.type === 'pointer') fail(`${field} update expectation is missing`);
  return Object.freeze({
    phase: 'update',
    reason: expectation.reason,
    changedFrom: expectation.changedFrom,
    barsLength: expectation.barsLength,
    commands,
  });
}

export function createUserIndicatorOutputValidationState(): UserIndicatorOutputValidationState {
  return Object.freeze({
    panes: new Set<string>(['main']),
    series: new Map<string, SeriesResource>(),
    markers: new Set<string>(),
    barStyles: new Set<string>(),
    canvases: new Map<string, CanvasResource>(),
    panels: new Map<string, PanelResource>(),
  });
}

export function validateUserIndicatorOutputEnvelope(
  value: unknown,
  state: UserIndicatorOutputValidationState,
  expectation: UserIndicatorOutputExpectation,
): ValidatedUserIndicatorOutput {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    fail(`output is not JSON serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (new TextEncoder().encode(serialized).byteLength > outputByteLimit(expectation)) {
    limit(`serialized output exceeds ${outputByteLimit(expectation)} bytes`);
  }

  const envelope = record(value, 'output');
  allowedKeys(envelope, new Set(['callbacks']), 'output');
  if (!Array.isArray(envelope.callbacks)) fail('output.callbacks must be an array');
  const expectedPhases: readonly UserIndicatorCallbackOutput['phase'][] = expectation.type === 'create'
    ? ['create', 'update']
    : expectation.type === 'pointer'
      ? ['pointer']
      : ['update'];
  if (envelope.callbacks.length !== expectedPhases.length) {
    fail(`output.callbacks must contain ${expectedPhases.length} callback result(s)`);
  }

  const panes = new Set(state.panes);
  const series = new Map(state.series);
  const markers = new Set(state.markers);
  const barStyles = new Set(state.barStyles);
  const canvases = new Map(state.canvases);
  const panels = new Map(state.panels);
  const callbackResults: UserIndicatorCallbackOutput[] = [];
  for (let index = 0; index < envelope.callbacks.length; index += 1) {
    const phase = expectedPhases[index];
    try {
      callbackResults.push(validateCallback(
        envelope.callbacks[index],
        phase,
        expectation,
        panes,
        series,
        markers,
        barStyles,
        canvases,
        panels,
        `output.callbacks[${index}]`,
      ));
    } catch (error) {
      if (error instanceof UserIndicatorOutputError && error.phase === undefined) {
        throw new UserIndicatorOutputError(error.code, error.message, phase);
      }
      throw error;
    }
  }
  const callbacks = Object.freeze(callbackResults);

  return Object.freeze({
    output: Object.freeze({ callbacks }),
    state: Object.freeze({ panes, series, markers, barStyles, canvases, panels }),
  });
}

export const USER_INDICATOR_RUNTIME_LIMITS = Object.freeze({
  sourceBytes: 256 * 1024,
  definitionSnapshotBytes: 1024 * 1024,
  indicatorIdChars: 128,
  inputDefinitions: 64,
  dataRequests: 8,
  crossSymbolDataRequests: 4,
  crossSymbolDataSymbols: 3,
  dataBarsPerRequest: 12_000,
  depthLevelsPerSide: 50,
  tradesPerCallback: 256,
  inputKeyChars: 64,
  selectOptionsPerInput: 256,
  selectValueChars: 128,
  metadataTextChars: 512,
  descriptionChars: 4_096,
  textInputMaxLength: 4_096,
  importedIndicators: 4_096,
  storedSourceBytes: 16 * 1024 * 1024,
  activeInstances: 16,
  stagedDrafts: 8,
  resourceKeyChars: 64,
  paneMinHeight: 40,
  paneMaxHeight: 2_000,
  seriesLineWidthMax: 4,
  canvasLineWidthMax: 16,
  canvasFontSizeMin: 6,
  canvasFontSizeMax: 72,
  canvasPixelMagnitudeMax: 100_000,
  canvasRadiusMax: 10_000,
  quickJsHeapBytes: 32 * 1024 * 1024,
  quickJsStackBytes: 512 * 1024,
  definitionVmMs: 250,
  definitionHardMs: 1_000,
  createVmMs: 250,
  createHardMs: 1_000,
  /** Compatibility aggregate ceiling; actual update enforcement is reason-specific below. */
  bulkUpdateVmMs: 2_000,
  bulkUpdateHardMs: 3_000,
  initialUpdateVmMs: 2_000,
  initialUpdateHardMs: 3_000,
  historyUpdateVmMs: 1_000,
  historyUpdateHardMs: 2_000,
  realtimeUpdateVmMs: 100,
  realtimeUpdateHardMs: 500,
  pointerVmMs: 100,
  pointerHardMs: 500,
  reconciliationUpdateVmMs: 2_000,
  reconciliationUpdateHardMs: 3_000,
  orderFlowVmMs: 50,
  orderFlowHardMs: 250,
  destroyVmMs: 100,
  destroyHardMs: 300,
  panes: 4,
  series: 32,
  seriesDataPointsPerCallback: 12_000,
  canvasLayers: 8,
  panels: 8,
  markersPerCallback: 2_000,
  canvasCommandsPerCallback: 5_000,
  canvasPointsPerCommand: 2_000,
  panelRows: 200,
  panelCells: 1_000,
  textFieldChars: 512,
  callbackTextBytes: 64 * 1024,
  outboxCommandsPerCallback: 256,
  realtimeOutputBytes: 4 * 1024 * 1024,
  bulkOutputBytes: 8 * 1024 * 1024,
  consoleEntriesPerCallback: 64,
  consoleBytesPerCallback: 16 * 1024,
} as const);

export type UserIndicatorRuntimeLimits = typeof USER_INDICATOR_RUNTIME_LIMITS;

export type UserIndicatorUpdateReason = 'initial' | 'history' | 'realtime' | 'reconciliation';

export function userIndicatorUpdateVmMs(reason: UserIndicatorUpdateReason): number {
  if (reason === 'initial') return USER_INDICATOR_RUNTIME_LIMITS.initialUpdateVmMs;
  if (reason === 'history') return USER_INDICATOR_RUNTIME_LIMITS.historyUpdateVmMs;
  if (reason === 'realtime') return USER_INDICATOR_RUNTIME_LIMITS.realtimeUpdateVmMs;
  return USER_INDICATOR_RUNTIME_LIMITS.reconciliationUpdateVmMs;
}

export function userIndicatorUpdateHardMs(reason: UserIndicatorUpdateReason): number {
  if (reason === 'initial') return USER_INDICATOR_RUNTIME_LIMITS.initialUpdateHardMs;
  if (reason === 'history') return USER_INDICATOR_RUNTIME_LIMITS.historyUpdateHardMs;
  if (reason === 'realtime') return USER_INDICATOR_RUNTIME_LIMITS.realtimeUpdateHardMs;
  return USER_INDICATOR_RUNTIME_LIMITS.reconciliationUpdateHardMs;
}

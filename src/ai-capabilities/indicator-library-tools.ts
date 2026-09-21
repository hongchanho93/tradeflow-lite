import { CapabilityError, type AsyncToolTransaction, type JsonValue, type ToolDefinition, type ToolExecutionContext,
  type ToolSessionScope, type ValueSchema } from './contracts.ts';
import { objectSchema } from './chart-data.ts';
import { UserIndicatorLibraryError, type PreparedUserIndicatorImport, type UserIndicatorLibrary } from '../user-indicator-runtime/library.ts';
import { USER_INDICATOR_RUNTIME_LIMITS } from '../user-indicator-runtime/limits.ts';
import { USER_INDICATOR_AI_API_SUMMARY, USER_INDICATOR_MINIMAL_TEMPLATE, safeUserIndicatorFailureDetail } from '../user-indicator-runtime/ai-guide.ts';
import type { UserIndicatorPreflightResult } from '../user-indicator-runtime/preflight.ts';
import { extensionSourceHash } from '../user-extension/source-version.ts';

export interface IndicatorLibraryHost {
  library(): UserIndicatorLibrary | null;
  test(prepared: PreparedUserIndicatorImport, execution: ToolExecutionContext): Promise<UserIndicatorPreflightResult>;
  prepareChange(prepared: PreparedUserIndicatorImport | null, indicatorId: string, applyToExisting: boolean,
    execution: ToolExecutionContext): Promise<AsyncToolTransaction>;
}
type Draft = { prepared: PreparedUserIndicatorImport; owner: object; lifetime: ToolSessionScope; expires: number; remove(): void };
const text = (maxLength = 256): ValueSchema => ({ type: 'string', maxLength });
const number: ValueSchema = { type: 'integer', minimum: 0 };
export const libraryMutationSchema = objectSchema({ indicatorId: text(), indicatorVersion: number,
  state: { type: 'string', enum: ['installed', 'removed'] } });
const preflightLimitsSchema = objectSchema({
  dataRequests: number, crossSymbolDataRequests: number, crossSymbolDataSymbols: number, dataBarsPerRequest: number,
  depthLevelsPerSide: number, tradesPerCallback: number,
  quickJsHeapBytes: number, quickJsStackBytes: number,
  panes: number, paneMinHeight: number, paneMaxHeight: number, series: number, seriesDataPointsPerCallback: number,
  canvasLayers: number, panels: number, outboxCommandsPerCallback: number, markersPerCallback: number,
  canvasCommandsPerCallback: number, canvasPointsPerCommand: number, panelRows: number, panelCells: number,
  textFieldChars: number, callbackTextBytes: number, logEntriesPerCallback: number, logBytesPerCallback: number,
  bulkOutputBytes: number, realtimeOutputBytes: number, createVmMs: number, createHardMs: number,
  bulkUpdateVmMs: number, bulkUpdateHardMs: number,
  initialUpdateVmMs: number, initialUpdateHardMs: number, historyUpdateVmMs: number, historyUpdateHardMs: number,
  realtimeUpdateVmMs: number, realtimeUpdateHardMs: number,
  reconciliationUpdateVmMs: number, reconciliationUpdateHardMs: number,
}, ['dataRequests','crossSymbolDataRequests','crossSymbolDataSymbols','dataBarsPerRequest','depthLevelsPerSide','tradesPerCallback',
  'quickJsHeapBytes','quickJsStackBytes','panes','paneMinHeight','paneMaxHeight','series','seriesDataPointsPerCallback',
  'canvasLayers','panels','outboxCommandsPerCallback','markersPerCallback','canvasCommandsPerCallback','canvasPointsPerCommand',
  'panelRows','panelCells','textFieldChars','callbackTextBytes','logEntriesPerCallback','logBytesPerCallback',
  'bulkOutputBytes','realtimeOutputBytes','createVmMs','createHardMs','bulkUpdateVmMs','bulkUpdateHardMs',
  'initialUpdateVmMs','initialUpdateHardMs','historyUpdateVmMs','historyUpdateHardMs',
  'realtimeUpdateVmMs','realtimeUpdateHardMs','reconciliationUpdateVmMs','reconciliationUpdateHardMs']);

/** Staged source stays in the existing validator/runtime, never the application JavaScript context. */
export function createIndicatorLibraryTools(host: IndicatorLibraryHost, now = () => performance.now()): readonly ToolDefinition[] {
  const drafts = new Map<string, Draft>();
  let pending = 0;
  const library = () => { const result = host.library(); if (!result) throw new CapabilityError('data_not_ready'); return result; };
  const prune = () => { for (const draft of drafts.values()) if (draft.lifetime.signal.aborted || draft.expires <= now()) draft.remove(); };
  const identity = (scope: ToolSessionScope): object => scope.sessionIdentity ?? scope;
  const get = (id: string, ctx: ToolExecutionContext) => {
    ctx.checkpoint(); prune(); const draft = drafts.get(id);
    if (!draft || draft.owner !== identity(ctx.session)) throw new CapabilityError('snapshot_unavailable'); return draft;
  };
  const mapped = (error: unknown): never => {
    if (error instanceof CapabilityError) throw error;
    if (error instanceof UserIndicatorLibraryError) {
      if (error.code === 'stale_import_preview') throw new CapabilityError('state_conflict');
      if (error.code.includes('limit_exceeded')) throw new CapabilityError('session_capacity');
      throw new CapabilityError('invalid_request');
    }
    throw new CapabilityError('storage_failed');
  };
  return [
    { id: 'tf.indicator.guide', version: 1, scope: 'app', effect: 'read',
      description: 'Read the actual supported .tfi indicator API and a complete working template. Use this before generating or editing a user indicator.',
      inputSchema: objectSchema({}), outputSchema: objectSchema({ api: text(32768), template: text(32768) }),
      run: () => ({ api: USER_INDICATOR_AI_API_SUMMARY, template: USER_INDICATOR_MINIMAL_TEMPLATE }) },
    { id: 'tf.indicator.source', version: 1, scope: 'app', effect: 'read',
      description: 'Read source of one imported user indicator for a requested modification. This never reads application source, arbitrary files, or credentials.',
      inputSchema: objectSchema({ indicatorId: text() }),
      outputSchema: objectSchema({ indicatorId: text(), indicatorVersion: number, fileName: text(), sourceHash: text(64), source: text(USER_INDICATOR_RUNTIME_LIMITS.sourceBytes) }),
      async run(input, ctx) {
        try {
          const record = await library().get((input as { indicatorId: string }).indicatorId); ctx.checkpoint();
          if (!record) throw new CapabilityError('field_unavailable');
          return { indicatorId: record.id, indicatorVersion: record.indicatorVersion, fileName: `${record.id}.tfi`, sourceHash: record.sourceHash, source: record.source };
        } catch (error) { return mapped(error); }
      } },
    { id: 'tf.indicator.validate', version: 1, scope: 'app', effect: 'read', timeoutMs: 10_000,
      description: 'Validate .tfi source in an isolated Worker, without installation or chart changes. valid=false returns errorCode plus available field/reason/expected/failureDetail/line/column repair diagnostics. For chart use, pass the resulting draftId to tf_indicator_test before installation.',
      inputSchema: objectSchema({ source: text(USER_INDICATOR_RUNTIME_LIMITS.sourceBytes), fileName: text() }, ['source']),
      outputSchema: objectSchema({ valid: { type: 'boolean' }, extensionType: text(), stage: text(), sourceHash: text(64), draftId: text(), indicatorId: text(), indicatorVersion: number,
        manifestJson: text(128 * 1024), disposition: text(), errorCode: text(), field: text(512), reason: text(256), expected: text(512), failureDetail: text(512), line: number, column: number }, ['valid','extensionType','stage','sourceHash']),
      async run(input, ctx): Promise<JsonValue> {
        prune(); if (drafts.size + pending >= USER_INDICATOR_RUNTIME_LIMITS.stagedDrafts) {
          throw new CapabilityError('snapshot_capacity', {
            resource: 'indicator_drafts', limit: USER_INDICATOR_RUNTIME_LIMITS.stagedDrafts,
            inUse: drafts.size + pending, hint: 'install or release an unused indicator draft',
          });
        }
        const value = input as { source: string; fileName?: string }; const sourceHash = await extensionSourceHash(value.source); pending++;
        try {
          const prepared = await library().prepareImport(value.fileName ?? 'indicator.tfi', new TextEncoder().encode(value.source));
          ctx.checkpoint();
          const id = `indicator-draft-${crypto.randomUUID()}`;
          const remove = () => { drafts.delete(id); ctx.session.signal.removeEventListener('abort', remove); ctx.signal.removeEventListener('abort', remove); };
          drafts.set(id, { prepared, owner: identity(ctx.session), lifetime: ctx.session, expires: now() + 5 * 60_000, remove });
          ctx.session.signal.addEventListener('abort', remove, { once: true });
          ctx.signal.addEventListener('abort', remove, { once: true });
          return { valid: true, extensionType: 'indicator', stage: 'validate', sourceHash, draftId: id, indicatorId: prepared.manifest.id, indicatorVersion: prepared.manifest.indicatorVersion,
            manifestJson: JSON.stringify(prepared.manifest), disposition: prepared.disposition };
        } catch (error) {
          ctx.checkpoint();
          if (!(error instanceof UserIndicatorLibraryError)) return mapped(error);
          return { valid: false, extensionType: 'indicator', stage: 'validate', sourceHash, errorCode: error.code, ...(error.field ? { field: error.field.slice(0, 512) } : {}),
            ...(error.reason ? { reason: error.reason.slice(0, 256) } : {}), ...(error.expected ? { expected: error.expected.slice(0, 512) } : {}),
            ...(error.failureDetail || error.message ? { failureDetail: safeUserIndicatorFailureDetail(error.failureDetail ?? error.message) } : {}),
            ...(error.line === undefined ? {} : { line: error.line }), ...(error.column === undefined ? {} : { column: error.column }) };
        } finally { pending--; }
      } },
    { id: 'tf.indicator.draft_release', version: 1, scope: 'app', effect: 'read',
      description: 'Release one session-owned validated indicator draft that will not be installed. Use this after a failed test or abandoned edit so iterative development does not retain draft capacity.',
      inputSchema: objectSchema({ draftId: text() }, ['draftId']),
      outputSchema: objectSchema({ released: { type: 'boolean' } }, ['released']),
      run(input, ctx) { const draft = get((input as { draftId: string }).draftId, ctx); draft.remove(); return { released: true }; } },
    { id: 'tf.indicator.test', version: 1, title: '预运行用户指标', scope: 'chart', effect: 'read', timeoutMs: 10_000,
      description: 'Run one validated .tfi draft against the current chart retained OHLCV history in the existing isolated execution Worker. Replays initial → history → realtime → reconciliation in one persistent runtime instance. Pointer phases run only when an interactive target exists and lifecycle.onPointer is implemented. Catchable callback failures retain bounded context.log entries written before the error. This never installs the draft or changes chart state; valid=false is a runtime repair diagnostic.',
      inputSchema: objectSchema({ draftId: text() }, ['draftId']),
      outputSchema: objectSchema({ valid: { type: 'boolean' }, extensionType: text(), stage: text(), sourceHash: text(64),
        indicatorId: text(), indicatorVersion: number, sampleRows: number, failurePhase: text(64), errorCode: text(128), failureDetail: text(512),
        allSeriesEmpty: { type: 'boolean' }, allOutputsEmpty: { type: 'boolean' },
        coveredReasons: { type: 'array', maxItems: 4, items: { type: 'string', enum: ['initial','history','realtime','reconciliation'] } },
        coveredPointerTypes: { type: 'array', maxItems: 3, items: { type: 'string', enum: ['hover','click','leave'] } },
        timings: { type: 'array', maxItems: 4, items: objectSchema({
          reason: { type: 'string', enum: ['initial','history','realtime','reconciliation'] }, durationMs: number, budgetMs: number,
        }, ['reason','durationMs','budgetMs']) },
        pointerTimings: { type: 'array', maxItems: 3, items: objectSchema({
          type: { type: 'string', enum: ['hover','click','leave'] }, durationMs: number, budgetMs: number,
        }, ['type','durationMs','budgetMs']) },
        limits: preflightLimitsSchema,
        series: { type: 'array', maxItems: 32, items: objectSchema({
          key: text(64), type: text(32), points: number, ready: number,
          firstReadyTime: number, lastReadyTime: number, allEmpty: { type: 'boolean' },
        }, ['key','type','points','ready','allEmpty']) },
        markers: { type: 'array', maxItems: USER_INDICATOR_RUNTIME_LIMITS.outboxCommandsPerCallback, items: objectSchema({
          key: text(64), points: number, firstTime: number, lastTime: number, allEmpty: { type: 'boolean' },
        }, ['key','points','allEmpty']) },
        barStyles: { type: 'array', maxItems: USER_INDICATOR_RUNTIME_LIMITS.outboxCommandsPerCallback, items: objectSchema({
          key: text(64), points: number, firstTime: number, lastTime: number, allEmpty: { type: 'boolean' },
        }, ['key','points','allEmpty']) },
        canvases: { type: 'array', maxItems: 8, items: objectSchema({
          key: text(64), commands: number, allEmpty: { type: 'boolean' },
        }, ['key','commands','allEmpty']) },
        panels: { type: 'array', maxItems: 8, items: objectSchema({
          key: text(64), columns: number, rows: number, cells: number, allEmpty: { type: 'boolean' },
        }, ['key','columns','rows','cells','allEmpty']) },
        logs: { type: 'array', maxItems: USER_INDICATOR_RUNTIME_LIMITS.consoleEntriesPerCallback * 8, items: objectSchema({
          phase: { type: 'string', enum: ['create','update','pointer'] }, message: text(512),
        }, ['phase','message']) } },
        ['valid','extensionType','stage','sourceHash','indicatorId','indicatorVersion','sampleRows','coveredReasons','coveredPointerTypes','timings','pointerTimings','limits']),
      async run(input, ctx): Promise<JsonValue> {
        const draft = get((input as { draftId: string }).draftId, ctx);
        const tested = await host.test(draft.prepared, ctx); ctx.checkpoint();
        return { valid: tested.valid, extensionType: 'indicator', stage: 'runtime', sourceHash: draft.prepared.sourceHash,
          indicatorId: draft.prepared.manifest.id, indicatorVersion: draft.prepared.manifest.indicatorVersion,
          sampleRows: tested.sampleRows, coveredReasons: tested.coveredReasons, coveredPointerTypes: tested.coveredPointerTypes,
          timings: tested.timings, pointerTimings: tested.pointerTimings, limits: tested.limits, logs: tested.logs,
          ...(!tested.valid ? {
            failurePhase: tested.failurePhase, errorCode: tested.errorCode,
            ...(tested.failureDetail ? { failureDetail: tested.failureDetail } : {}),
          } : {
            allSeriesEmpty: tested.allSeriesEmpty, allOutputsEmpty: tested.allOutputsEmpty,
            series: tested.series, markers: tested.markers, barStyles: tested.barStyles,
            canvases: tested.canvases, panels: tested.panels,
          }) };
      } },
    { id: 'tf.indicator.install', version: 1, scope: 'app', effect: 'write', timeoutMs: 15_000,
      description: 'Install a validated user indicator draft. For “modify the existing indicator”, keep the same indicator id, increment indicatorVersion, and use applyToExisting=true so compatible current instances migrate in place; do not add a duplicate instance afterward unless the user asks for another copy. Add a new chart instance with tf_indicator_add only when needed. No application source changes.',
      inputSchema: objectSchema({ draftId: text(), applyToExisting: { type: 'boolean' } }, ['draftId']), outputSchema: libraryMutationSchema,
      run() { throw new CapabilityError('invalid_contract'); },
      async prepareAsync(input, ctx) {
        const { draftId, applyToExisting = true } = input as { draftId: string; applyToExisting?: boolean };
        const draft = get(draftId, ctx);
        try {
          const transaction = await host.prepareChange(draft.prepared, draft.prepared.manifest.id, applyToExisting, ctx);
          let committed = false;
          return {
            result: transaction.result,
            async commit() { await transaction.commit(); committed = true; },
            async rollback() { try { await transaction.rollback(); } finally { committed = false; } },
            dispose() { try { transaction.dispose?.(); } finally { if (committed) draft.remove(); } },
          };
        }
        catch (error) { return mapped(error); }
      } },
    { id: 'tf.indicator.library_remove', version: 1, scope: 'app', effect: 'write',
      description: 'Remove one imported user indicator from the library and stop its instances. Preserve their saved parameters as unresolved so reimporting the same source can recover them. Built-in indicators are not deleted.',
      inputSchema: objectSchema({ indicatorId: text() }), outputSchema: libraryMutationSchema,
      run() { throw new CapabilityError('invalid_contract'); },
      async prepareAsync(input, ctx) {
        try { return await host.prepareChange(null, (input as { indicatorId: string }).indicatorId, false, ctx); }
        catch (error) { return mapped(error); }
      } },
  ];
}

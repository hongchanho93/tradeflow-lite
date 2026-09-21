import { CapabilityError, type AsyncToolTransaction, type JsonValue, type ToolDefinition, type ToolExecutionContext, type ToolSessionScope, type ValueSchema } from './contracts.ts';
import { objectSchema } from './chart-data.ts';

export type ResultFileDestination = 'desktop' | 'documents' | 'downloads';
export type ResultFileFormat = 'markdown' | 'text' | 'csv' | 'json';
export interface ResultFilePrepareInput {
  destination: ResultFileDestination;
  folder?: string;
  filename: string;
  content: string;
}
export interface PreparedResultFile {
  ticket: string;
  destination: ResultFileDestination;
  displayPath: string;
  filename: string;
  bytes: number;
}
export interface ResultFilePort {
  prepare(input: ResultFilePrepareInput, signal: AbortSignal): Promise<PreparedResultFile>;
  commit(ticket: string): Promise<void>;
  rollback(ticket: string): Promise<void>;
}
export interface TaskArtifactFile {
  content: string;
  filename: string;
  format: ResultFileFormat;
}
export interface ResultFileHost {
  port: ResultFilePort;
  taskArtifact?(taskId: string, artifactId: string, format: 'auto' | 'markdown' | 'csv' | 'json', owner: ToolSessionScope): TaskArtifactFile;
}

const text = (maxLength = 512): ValueSchema => ({ type: 'string', maxLength });
const formatSchema: ValueSchema = { type: 'string', enum: ['auto','markdown','text','csv','json'] };
const destinationSchema: ValueSchema = { type: 'string', enum: ['desktop','documents','downloads'] };
const FILE_CONTENT_LIMIT = 12 * 1024 * 1024;
const extensions: Readonly<Record<ResultFileFormat, string>> = Object.freeze({ markdown: 'md', text: 'txt', csv: 'csv', json: 'json' });

function filenameFor(name: string | undefined, format: ResultFileFormat, fallback: string): string {
  const base = (name?.trim() || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\.+$/g, '').trim();
  if (!base) throw new CapabilityError('invalid_request');
  const ext = extensions[format];
  return new RegExp('\\.' + ext + '$', 'i').test(base)
    ? base
    : base.replace(/\.(?:md|txt|csv|json|tsv)$/i, '') + '.' + ext;
}

function taskInput(input: Record<string, JsonValue>, host: ResultFileHost, context: ToolExecutionContext): TaskArtifactFile {
  if (!host.taskArtifact || typeof input.taskId !== 'string' || typeof input.artifactId !== 'string') throw new CapabilityError('invalid_request');
  const format = typeof input.format === 'string' && ['auto','markdown','csv','json'].includes(input.format) ? input.format as 'auto'|'markdown'|'csv'|'json' : 'auto';
  return host.taskArtifact(input.taskId, input.artifactId, format, context.session);
}

/** Write-only result delivery. It cannot list/read/delete files or accept absolute paths.
 * The user-facing workflow is natural language: "save this to Desktop/research". */
export function createResultFileTools(host: ResultFileHost): readonly ToolDefinition[] {
  return [{
    id: 'tf.result.save_file',
    version: 1,
    title: '保存分析结果文件',
    scope: 'app',
    effect: 'write',
    timeoutMs: 120_000,
    description: 'Save a generated analysis or a full task artifact directly to Desktop, Documents, or Downloads. No file picker or follow-up approval. Use source=task for full task results so the model does not need to copy every row. If the user says only save/export this without a destination, prefer desktop. Markdown for narrative documents, CSV for tables, JSON only when requested. Never claim a file was saved unless this tool succeeds. This tool cannot read, overwrite, delete, execute, or access arbitrary paths.',
    inputSchema: objectSchema({
      source: { type: 'string', enum: ['text','task'] },
      destination: destinationSchema,
      folder: text(512),
      filename: text(180),
      format: formatSchema,
      content: text(FILE_CONTENT_LIMIT),
      taskId: text(256),
      artifactId: text(256),
    }, ['source']),
    outputSchema: objectSchema({
      saved: { type: 'boolean' },
      destination: destinationSchema,
      path: text(1024),
      filename: text(220),
      bytes: { type: 'integer', minimum: 0, maximum: FILE_CONTENT_LIMIT },
      format: { type: 'string', enum: ['markdown','text','csv','json'] },
    }, ['saved','destination','path','filename','bytes','format']),
    run() { throw new CapabilityError('invalid_contract'); },
    async prepareAsync(raw, context): Promise<AsyncToolTransaction> {
      const input = raw as Record<string, JsonValue>;
      const destination = (input.destination as ResultFileDestination | undefined) ?? 'desktop';
      if (!['desktop','documents','downloads'].includes(destination)) throw new CapabilityError('invalid_request');
      let content: string, format: ResultFileFormat, fallback: string;
      if (input.source === 'task') {
        const exported = taskInput(input, host, context);
        content = exported.content; format = exported.format; fallback = exported.filename;
      } else if (input.source === 'text') {
        if (typeof input.content !== 'string') throw new CapabilityError('invalid_request');
        content = input.content;
        format = typeof input.format === 'string' && ['markdown','text','csv','json'].includes(input.format)
          ? input.format as ResultFileFormat : 'markdown';
        fallback = 'TradeFlow-result';
      } else throw new CapabilityError('invalid_request');
      if (new TextEncoder().encode(content).length > FILE_CONTENT_LIMIT) throw new CapabilityError('invalid_request');
      const filename = filenameFor(typeof input.filename === 'string' ? input.filename : undefined, format, fallback);
      let prepared: PreparedResultFile | undefined;
      try {
        context.checkpoint();
        prepared = await host.port.prepare({
          destination,
          ...(typeof input.folder === 'string' && input.folder.trim() ? { folder: input.folder.trim() } : {}),
          filename,
          content,
        }, context.signal);
        context.checkpoint();
      } catch (error) {
        if (prepared) await host.port.rollback(prepared.ticket).catch(() => {});
        if (error instanceof CapabilityError) throw error;
        throw new CapabilityError('storage_failed');
      }
      const ticket = prepared.ticket;
      return {
        result: {
          saved: true, destination: prepared.destination, path: prepared.displayPath,
          filename: prepared.filename, bytes: prepared.bytes, format,
        },
        async commit() {
          try { context.checkpoint(); await host.port.commit(ticket); context.checkpoint(); return undefined; }
          catch { throw new CapabilityError('storage_failed'); }
        },
        async rollback() {
          try { await host.port.rollback(ticket); return undefined; }
          catch { throw new CapabilityError('rollback_failed'); }
        },
      };
    },
  }];
}

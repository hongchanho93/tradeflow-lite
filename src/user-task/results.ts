import type { JsonValue } from '../ai-capabilities/contracts.ts';
import { TASK_LIMITS, TaskError, exact, object, taskJson, taskSymbol, type ArtifactDescriptor } from './contracts.ts';

type Entry = { descriptor: ArtifactDescriptor; rows: JsonValue[]; chunks: string[]; chars: number; lastTime: number };
export interface ResultPageQuery { offset?: number; limit?: number; sortBy?: string; descending?: boolean; filter?: string }
export interface ResultPage { artifactId: string; type: string; title: string; total: number; matched: number; offset: number;
  rows: readonly JsonValue[]; pageUnit: 'rows' | 'characters'; complete: boolean; nextOffset?: number; text?: string; columns?: ArtifactDescriptor['columns'] }
const cellText = (v: JsonValue): string => v === null ? '' : object(v) && typeof v.symbol === 'string' ? v.symbol : String(v);
const searchText = (v: JsonValue): string => {
  if (v === null) return '';
  if (object(v) && typeof v.symbol === 'string') {
    return [v.symbol, v.name, v.providerId, v.kind].filter(item => typeof item === 'string').join(' ');
  }
  return String(v);
};

/** App-owned standard artifacts. No guest renderer, DOM, URL or filesystem access. */
export class TaskResultStore {
  readonly #entries = new Map<string, Entry>();
  #bytes = 0; #rows = 0; #closed = false;
  constructor(descriptors: readonly ArtifactDescriptor[]) {
    for (const descriptor of descriptors) this.#entries.set(descriptor.id, { descriptor, rows: [], chunks: [], chars: 0, lastTime: -Infinity });
  }
  get bytes(): number { return this.#bytes; }
  describe() { this.#check(); return [...this.#entries.values()].map(e => ({ ...e.descriptor, rows: e.rows.length, characters: e.chars })); }
  #check() { if (this.#closed) throw new TaskError('task_result_unavailable'); }
  append(value: unknown, byteBudget: number = TASK_LIMITS.resultBytes): void {
    this.#check(); const batch = taskJson(value);
    if (!Array.isArray(batch) || batch.length > 64) throw new TaskError('task_invalid_output');
    const pending: { entry: Entry; rows?: JsonValue[]; text?: string }[] = [];
    const lastTimes = new Map<Entry, number>(); let newRows = 0, newBytes = 0;
    const invalid = (): never => { throw new TaskError('task_invalid_output'); };
    for (const part of batch) {
      exact(part, ['artifactId','rows','text'], ['artifactId']);
      const entry = this.#entries.get(part.artifactId as string); if (!entry) invalid();
      const e = entry!, d = e.descriptor;
      if (d.type === 'report') {
        if (typeof part.text !== 'string' || part.rows !== undefined) invalid();
        newBytes += new TextEncoder().encode(part.text as string).length; pending.push({ entry: e, text: part.text as string });
      } else {
        if (!Array.isArray(part.rows) || part.text !== undefined) invalid();
        const rows: JsonValue[] = (part.rows as readonly JsonValue[]).map(row => {
          if (d.type === 'symbol_list') return taskJson(taskSymbol(row));
          if (d.type === 'series') {
            exact(row, ['time','value']);
            if (!Number.isSafeInteger(row.time) || typeof row.value !== 'number' || !Number.isFinite(row.value)
              || (row.time as number) <= (lastTimes.get(e) ?? e.lastTime)) invalid();
            lastTimes.set(e, row.time as number); return row as JsonValue;
          }
          if (!Array.isArray(row) || row.length !== d.columns!.length) invalid();
          return Object.freeze((row as readonly JsonValue[]).map((cell, i) => {
            const type = d.columns![i].type;
            if (cell === null) return null;
            if (type === 'symbol') return taskJson(taskSymbol(cell));
            if (typeof cell !== type || (typeof cell === 'string' && cell.length > 16_384)) invalid();
            return cell;
          }));
        });
        newRows += rows.length; newBytes += new TextEncoder().encode(JSON.stringify(rows)).length; pending.push({ entry: e, rows });
      }
    }
    if (this.#bytes + newBytes > Math.min(byteBudget, TASK_LIMITS.resultBytes) || this.#rows + newRows > TASK_LIMITS.resultRows) throw new TaskError('task_result_limit');
    // No mutations until every artifact and the combined budget have passed.
    for (const p of pending) {
      if (p.rows) { for (const row of p.rows) p.entry.rows.push(row); }
      else if (p.text) { p.entry.chunks.push(p.text); p.entry.chars += p.text.length; }
    }
    for (const [entry, time] of lastTimes) entry.lastTime = time;
    this.#bytes += newBytes; this.#rows += newRows;
  }
  page(artifactId: string, query: ResultPageQuery = {}): ResultPage {
    this.#check(); const e = this.#entries.get(artifactId); if (!e) throw new TaskError('task_result_unavailable');
    const offset = query.offset ?? 0, limit = query.limit ?? (e.descriptor.type === 'report' ? 12_000 : 100);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1
      || limit > (e.descriptor.type === 'report' ? 16_000 : TASK_LIMITS.pageRows)
      || (query.filter !== undefined && (typeof query.filter !== 'string' || query.filter.length > 512))
      || (query.descending !== undefined && typeof query.descending !== 'boolean')) throw new TaskError('task_invalid_request');
    const d = e.descriptor;
    if (d.type === 'report') {
      if (query.sortBy !== undefined || query.filter !== undefined) throw new TaskError('task_invalid_request');
      let skip = offset, remaining = limit, text = '';
      for (const chunk of e.chunks) { if (skip >= chunk.length) { skip -= chunk.length; continue; }
        const part = chunk.slice(skip, skip + remaining); text += part; remaining -= part.length; skip = 0; if (!remaining) break; }
      const complete = offset + text.length >= e.chars;
      return { artifactId, type: d.type, title: d.title, total: e.chars, matched: e.chars, offset, rows: [], text, pageUnit: 'characters', complete,
        ...(offset + text.length < e.chars ? { nextOffset: offset + text.length } : {}) };
    }
    let rows: readonly JsonValue[] = e.rows;
    if (query.filter) { const needle = query.filter.toLowerCase(); rows = rows.filter(row =>
      (Array.isArray(row) ? row.map(searchText).join(' ') : searchText(row)).toLowerCase().includes(needle)); }
    if (query.sortBy !== undefined) {
      const column = d.columns?.findIndex(c => c.id === query.sortBy) ?? -1;
      if (d.type !== 'table' || column < 0) throw new TaskError('task_invalid_request');
      rows = [...rows].sort((a, b) => {
        const av = (a as readonly JsonValue[])[column], bv = (b as readonly JsonValue[])[column];
        const compared = typeof av === 'number' && typeof bv === 'number' ? av - bv : cellText(av).localeCompare(cellText(bv));
        return query.descending ? -compared : compared;
      });
    }
    const selected = rows.slice(offset, offset + limit);
    const complete = offset + selected.length >= rows.length;
    return { artifactId, type: d.type, title: d.title, total: e.rows.length, matched: rows.length, offset, rows: Object.freeze(selected), pageUnit: 'rows', complete,
      ...(d.columns ? { columns: d.columns } : {}), ...(offset + selected.length < rows.length ? { nextOffset: offset + selected.length } : {}) };
  }
  export(artifactId: string, format: 'csv' | 'json' | 'markdown'): string {
    this.#check(); const e = this.#entries.get(artifactId); if (!e) throw new TaskError('task_result_unavailable');
    if (format === 'json') return JSON.stringify({ ...e.descriptor, ...(e.descriptor.type === 'report' ? { text: e.chunks.join('') } : { rows: e.rows }) }, null, 2);
    if (format === 'markdown') {
      if (e.descriptor.type === 'report') return e.chunks.join('');
      const type = e.descriptor.type;
      const header = type === 'table' ? e.descriptor.columns!.map(c => c.title) : type === 'series' ? ['time','value'] : ['providerId','symbol','kind','name'];
      const rows = e.rows.map(row => type === 'table' ? row as readonly JsonValue[] : header.map(key => (row as Record<string, JsonValue>)[key]));
      const md = (value: JsonValue) => cellText(value).replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\r', '').replaceAll('\n', '<br>');
      return [
        '| ' + header.map(value => md(value)).join(' | ') + ' |',
        '| ' + header.map(() => '---').join(' | ') + ' |',
        ...rows.map(row => '| ' + row.map(md).join(' | ') + ' |'),
      ].join('\n');
    }
    if (format !== 'csv' || e.descriptor.type === 'report') throw new TaskError('task_invalid_request');
    const escape = (v: JsonValue) => {
      let value = cellText(v); if (/^[\s]*[=+@-]/.test(value) && typeof v !== 'number') value = `'${value}`;
      return `"${value.replaceAll('"', '""')}"`;
    };
    const type = e.descriptor.type;
    const header = type === 'table' ? e.descriptor.columns!.map(c => c.title) : type === 'series' ? ['time','value'] : ['providerId','symbol','kind','name'];
    const rows = e.rows.map(row => type === 'table' ? row as readonly JsonValue[] : header.map(key => (row as Record<string, JsonValue>)[key]));
    return '\uFEFF' + [header, ...rows].map(row => row.map(escape).join(',')).join('\r\n');
  }
  close(): void { this.#closed = true; this.#entries.clear(); this.#bytes = 0; this.#rows = 0; }
}

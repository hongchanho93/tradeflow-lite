import type { NativeWorkspacePort } from '../workspace-persistence.ts';
import type { ApiConversationSnapshot } from './conversation.ts';

const INDEX_KEY = 'tradeflow-lite.native.ai-conversations-index.v1';
const RECORD_PREFIX = 'tradeflow-lite.native.ai-conversation.v1.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AiConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AiConversationRecord extends AiConversationSummary {
  readonly snapshot: ApiConversationSnapshot;
}

function validSummary(value: unknown): value is AiConversationSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && UUID.test(row.id)
    && typeof row.title === 'string' && row.title.length > 0 && row.title.length <= 160
    && Number.isSafeInteger(row.createdAt) && Number(row.createdAt) > 0
    && Number.isSafeInteger(row.updatedAt) && Number(row.updatedAt) >= Number(row.createdAt);
}

function validSnapshot(value: unknown): value is ApiConversationSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (!Array.isArray(snapshot.messages) || !snapshot.usage || typeof snapshot.usage !== 'object' || Array.isArray(snapshot.usage)) return false;
  const usage = snapshot.usage as Record<string, unknown>;
  const token = (item: unknown) => item === null || (Number.isSafeInteger(item) && Number(item) >= 0);
  if (!token(usage.inputTokens) || !token(usage.outputTokens)) return false;
  return snapshot.messages.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const message = item as Record<string, unknown>;
    return ['user', 'assistant', 'tool'].includes(String(message.role))
      && typeof message.text === 'string'
      && (message.incomplete === undefined || typeof message.incomplete === 'boolean')
      && (message.toolTitle === undefined || typeof message.toolTitle === 'string');
  });
}

function parseIndex(raw: string | null): AiConversationSummary[] {
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const unique = new Set<string>();
    return value.filter((item): item is AiConversationSummary => {
      if (!validSummary(item) || unique.has(item.id)) return false;
      unique.add(item.id); return true;
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

function recordKey(id: string): string {
  if (!UUID.test(id)) throw new Error('conversation_invalid_id');
  return RECORD_PREFIX + id;
}

/** Native-only conversation archive. It stores display/history text but never
 * chart grants, approvals, credentials, pending writes or executable handles. */
export class AiConversationHistoryStore {
  readonly #native: NativeWorkspacePort;
  constructor(native: NativeWorkspacePort) { this.#native = native; }

  async list(): Promise<readonly AiConversationSummary[]> {
    if (!this.#native.available) return [];
    return parseIndex(await this.#native.get(INDEX_KEY));
  }

  async load(id: string): Promise<AiConversationRecord | null> {
    if (!this.#native.available) return null;
    const raw = await this.#native.get(recordKey(id));
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as Record<string, unknown>;
      if (!validSummary(value) || !validSnapshot(value.snapshot)) return null;
      return {
        id: value.id, title: value.title, createdAt: value.createdAt, updatedAt: value.updatedAt,
        snapshot: value.snapshot,
      } as AiConversationRecord;
    } catch { return null; }
  }

  async save(record: AiConversationRecord): Promise<void> {
    if (!this.#native.available) return;
    if (!validSummary(record) || !validSnapshot(record.snapshot)) throw new Error('conversation_invalid_record');
    await this.#native.set(recordKey(record.id), JSON.stringify(record));
    while (true) {
      const raw = await this.#native.get(INDEX_KEY);
      const rows = parseIndex(raw).filter(item => item.id !== record.id);
      rows.unshift({ id: record.id, title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt });
      if (await this.#native.compareExchange(INDEX_KEY, raw, JSON.stringify(rows))) return;
    }
  }

  async remove(id: string): Promise<void> {
    if (!this.#native.available) return;
    await this.#native.remove(recordKey(id));
    while (true) {
      const raw = await this.#native.get(INDEX_KEY);
      const next = parseIndex(raw).filter(item => item.id !== id);
      if (await this.#native.compareExchange(INDEX_KEY, raw, JSON.stringify(next))) return;
    }
  }
}

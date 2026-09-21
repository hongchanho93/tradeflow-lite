import type { JsonValue, ValueSchema } from '../ai-capabilities/contracts.ts';
import { parseJson, snapshotJson } from '../ai-capabilities/json.ts';

export type Protocol = 'chat' | 'responses' | 'anthropic';
export interface ApiSettings {
  protocol: Protocol; endpoint: string; model: string; stream: boolean; tools: boolean;
  includeUsage: boolean; chatTokenField: 'max_tokens' | 'max_completion_tokens'; maxTokens: number;
  timeoutSeconds: number; allowLocalHttp: boolean;
}
export interface ProfileView { revision: string; settings: ApiSettings; hasKey: boolean; remembered: boolean }
export interface ApiTool { name: string; title?: string; description: string; inputSchema: ValueSchema }
export interface ApiCall { id: string; name: string; arguments: string }
export interface Usage { inputTokens: number | null; outputTokens: number | null }
export interface ModelTurn { text: string; calls: readonly ApiCall[]; replay: readonly JsonValue[]; usage: Usage }
export type NativeFrame = { kind: 'event' | 'json'; data: string } | { kind: 'done' } | { kind: 'error'; code: string };
export type ModelActivity = 'thinking' | 'receiving';
// Process-safety guards only. These are deliberately far above normal model
// payloads and are not workflow quotas: conversation length, tool rounds and
// tool-call counts are controlled by the provider/user, not Lite.
export const API_LIMITS = Object.freeze({
  requestBytes: 64 * 1024 * 1024,
  replyBytes: 64 * 1024 * 1024,
  textBytes: 16 * 1024 * 1024,
  argumentBytes: 16 * 1024 * 1024,
  promptBytes: 4 * 1024 * 1024,
});
type Obj = { [key: string]: JsonValue };
export const object = (value: unknown): Obj => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_model_response');
  return value as Obj;
};
const array = (v: unknown): readonly JsonValue[] => { if (!Array.isArray(v)) throw new Error('invalid_model_response'); return v; };
const string = (v: unknown): string => { if (typeof v !== 'string') throw new Error('invalid_model_response'); return v; };
const bounded = (v: string, max = API_LIMITS.textBytes): string => {
  if (new TextEncoder().encode(v).length > max) throw new Error('response_too_large'); return v;
};
const count = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const copy = (v: unknown): JsonValue => snapshotJson(v, API_LIMITS.replyBytes).value;

export function buildRequest(settings: ApiSettings, history: readonly JsonValue[], tools: readonly ApiTool[], system: string): JsonValue {
  const p: Record<string, unknown> = { model: settings.model, stream: settings.stream };
  if (settings.protocol === 'chat') {
    p.messages = [{ role: 'system', content: system }, ...history]; p[settings.chatTokenField] = settings.maxTokens;
    if (tools.length) p.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    if (settings.stream && settings.includeUsage) p.stream_options = { include_usage: true };
  } else if (settings.protocol === 'responses') {
    p.input = history; p.instructions = system; p.store = false; p.include = ['reasoning.encrypted_content']; p.max_output_tokens = settings.maxTokens;
    if (tools.length) p.tools = tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema, strict: false }));
  } else {
    p.messages = history; p.instructions = undefined; p.system = system; p.max_tokens = settings.maxTokens;
    // `system` is top-level in Anthropic Messages, never a messages role.
    delete p.instructions;
    if (tools.length) p.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  }
  return snapshotJson(p, API_LIMITS.requestBytes).value;
}
export const userMessage = (text: string): JsonValue => ({ role: 'user', content: text });
export function toolResults(protocol: Protocol, results: readonly { call: ApiCall; text: string; error: boolean }[]): readonly JsonValue[] {
  if (protocol === 'anthropic') return [{ role: 'user', content: results.map(r => ({ type: 'tool_result', tool_use_id: r.call.id, content: r.text, is_error: r.error })) }];
  return results.map((r): JsonValue => protocol === 'chat' ? { role: 'tool', tool_call_id: r.call.id, content: r.text }
    : { type: 'function_call_output', call_id: r.call.id, output: r.text });
}
function callsValid(calls: ApiCall[]): readonly ApiCall[] {
  const ids = new Set<string>();
  for (const call of calls) {
    if (!call.id || call.id.length > 256 || ids.has(call.id) || !/^[a-zA-Z0-9_-]{1,64}$/.test(call.name)) throw new Error('invalid_tool_call');
    ids.add(call.id); bounded(call.arguments, API_LIMITS.argumentBytes);
    object(parseJson(call.arguments, API_LIMITS.argumentBytes).value);
  }
  return calls;
}

/** Pure bounded protocol decoder. Partial text can be displayed, but no tool
 * escapes until the complete, successfully terminated model turn is validated. */
export class TurnDecoder {
  readonly #protocol: Protocol; readonly #onText: (text: string) => void; readonly #onActivity: (activity: ModelActivity) => void;
  #text = ''; #reasoning = ''; #hasReasoning = false; #usage: Usage = { inputTokens: null, outputTokens: null };
  #chatCalls = new Map<number, ApiCall>(); #stop: string | null = null; #done = false;
  #anthropicStarted = false; #blocks = new Map<number, Obj>(); #openBlocks = new Set<number>();
  #argumentParts = new Map<number, string>(); #response?: Obj; #wireBytes = 0;
  #fragmentBytes = new Map<string, number>();
  constructor(protocol: Protocol, onText: (text: string) => void = () => {}, onActivity: (activity: ModelActivity) => void = () => {}) { this.#protocol = protocol; this.#onText = onText; this.#onActivity = onActivity; }
  #join(key: string, before: string, fragment: string, limit = API_LIMITS.textBytes): string {
    // Count new fragments, not the entire accumulated answer on every token.
    const encoder = new TextEncoder();
    const size = (this.#fragmentBytes.get(key) ?? encoder.encode(before).length) + encoder.encode(fragment).length;
    if (size > limit) throw new Error('response_too_large');
    this.#fragmentBytes.set(key,size); return before + fragment;
  }
  #append(text: string): void { this.#text = this.#join('text',this.#text,text); if (text) this.#onActivity('receiving'); this.#onText(this.#text); }
  #updateUsage(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const u = object(value); let input = count(u.input_tokens ?? u.prompt_tokens);
    if (this.#protocol === 'anthropic' && input !== null) input += (count(u.cache_read_input_tokens) ?? 0) + (count(u.cache_creation_input_tokens) ?? 0);
    this.#usage = { inputTokens: input ?? this.#usage.inputTokens, outputTokens: count(u.output_tokens ?? u.completion_tokens) ?? this.#usage.outputTokens };
  }
  consume(frame: NativeFrame): void {
    if (frame.kind === 'error') throw new Error(frame.code);
    if (frame.kind === 'done') return;
    this.#wireBytes += new TextEncoder().encode(frame.data).length;
    if (this.#wireBytes > API_LIMITS.replyBytes) throw new Error('response_too_large');
    if (frame.kind === 'event' && frame.data === '[DONE]') {
      if (this.#protocol !== 'chat' || !this.#stop) throw new Error('stream_incomplete');
      this.#done = true; return;
    }
    const data = object(parseJson(frame.data, API_LIMITS.replyBytes).value);
    if (data.error || ['error', 'response.failed', 'response.incomplete'].includes(String(data.type))) throw new Error('provider_stream_error');
    if (this.#done) throw new Error('invalid_stream_order');
    if (frame.kind === 'json') { this.#response = data; this.#done = true; return; }
    if (this.#protocol === 'chat') this.#chat(data);
    else if (this.#protocol === 'responses') {
      if (data.type === 'response.output_text.delta') this.#append(string(data.delta));
      if (data.type === 'response.completed') { this.#response = object(data.response); this.#done = true; }
    } else this.#anthropic(data);
  }
  #chat(data: Obj): void {
    this.#updateUsage(data.usage);
    const choices = array(data.choices); if (!choices.length) return;
    if (choices.length !== 1) throw new Error('unsupported_model_response');
    const choice = object(choices[0]); if (choice.index !== 0) throw new Error('invalid_model_response');
    const delta = object(choice.delta);
    if (this.#stop && (delta.content || delta.tool_calls || delta.reasoning_content)) throw new Error('invalid_stream_order');
    if (delta.content != null) this.#append(string(delta.content));
    if (delta.refusal != null) this.#append(string(delta.refusal));
    if (delta.reasoning_content != null) { this.#hasReasoning = true; this.#reasoning = this.#join('reasoning',this.#reasoning,string(delta.reasoning_content)); if (delta.reasoning_content && !delta.content) this.#onActivity('thinking'); }
    if (delta.function_call) throw new Error('unsupported_model_response');
    if (delta.tool_calls) for (const raw of array(delta.tool_calls)) {
      const d = object(raw); const index = d.index;
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) throw new Error('invalid_tool_call');
      const c = this.#chatCalls.get(index) ?? { id: '', name: '', arguments: '' }; const fn = d.function ? object(d.function) : {};
      if (d.type && d.type !== 'function') throw new Error('unsupported_model_response');
      if (d.id) { if (c.id) throw new Error('invalid_tool_call'); c.id = string(d.id); }
      if (fn.name) c.name = bounded(c.name + string(fn.name), 64);
      if (fn.arguments != null) c.arguments = this.#join(`arg-${index}`,c.arguments,string(fn.arguments),API_LIMITS.argumentBytes);
      this.#chatCalls.set(index, c);
    }
    if (choice.finish_reason != null) this.#stop = string(choice.finish_reason);
  }
  #anthropic(data: Obj): void {
    const type = data.type;
    if (type === 'message_start') { if (this.#anthropicStarted) throw new Error('invalid_stream_order'); this.#anthropicStarted = true; this.#updateUsage(object(data.message).usage); return; }
    if (type === 'ping') return;
    if (!this.#anthropicStarted) throw new Error('invalid_stream_order');
    if (['content_block_start', 'content_block_delta', 'content_block_stop'].includes(String(type))) {
      const index = data.index;
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) throw new Error('invalid_model_response');
      if (type === 'content_block_start') {
        if (this.#blocks.has(index)) throw new Error('invalid_stream_order');
        const block = { ...object(data.content_block) };
        if (!['text', 'tool_use', 'thinking', 'redacted_thinking'].includes(String(block.type))) throw new Error('unsupported_model_response');
        this.#blocks.set(index, block); this.#openBlocks.add(index);
        if (block.type === 'text' && block.text) this.#append(string(block.text));
      } else {
        const block = this.#blocks.get(index); if (!block || !this.#openBlocks.has(index)) throw new Error('invalid_stream_order');
        if (type === 'content_block_stop') {
          if (this.#argumentParts.has(index)) block.input = parseJson(this.#argumentParts.get(index)!, API_LIMITS.argumentBytes).value;
          this.#openBlocks.delete(index); return;
        }
        const delta = object(data.delta);
        if (delta.type === 'text_delta' && block.type === 'text') { const text = string(delta.text); block.text = this.#join(`text-${index}`,string(block.text),text); this.#append(text); }
        else if (delta.type === 'input_json_delta' && block.type === 'tool_use') this.#argumentParts.set(index, this.#join(`arg-${index}`,this.#argumentParts.get(index) ?? '',string(delta.partial_json),API_LIMITS.argumentBytes));
        else if (delta.type === 'thinking_delta' && block.type === 'thinking') block.thinking = this.#join(`thinking-${index}`,string(block.thinking),string(delta.thinking));
        else if (delta.type === 'signature_delta' && block.type === 'thinking') block.signature = this.#join(`signature-${index}`,String(block.signature ?? ''),string(delta.signature));
        else throw new Error('unsupported_model_response');
      }
    } else if (type === 'message_delta') { this.#stop = string(object(data.delta).stop_reason); this.#updateUsage(data.usage); }
    else if (type === 'message_stop') { if (this.#openBlocks.size) throw new Error('stream_incomplete'); this.#done = true; }
  }
  finish(): ModelTurn {
    if (!this.#done) throw new Error('stream_incomplete');
    let text = ''; let calls: ApiCall[] = []; let replay: JsonValue[] = [];
    if (this.#protocol === 'chat') {
      let message: Obj;
      if (this.#response) {
        const choices = array(this.#response.choices); if (choices.length !== 1) throw new Error('unsupported_model_response');
        const c = object(choices[0]); this.#stop = string(c.finish_reason); message = object(c.message); this.#updateUsage(this.#response.usage);
      } else {
        calls = [...this.#chatCalls.entries()].sort(([a], [b]) => a-b).map(([, c]) => c);
        message = { role: 'assistant', content: this.#text, ...(this.#hasReasoning ? { reasoning_content: this.#reasoning } : {}),
          ...(calls.length ? { tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}) };
      }
      if (this.#stop === 'length') throw new Error('model_output_limit');
      if (message.role !== 'assistant' || message.function_call || !['stop', 'tool_calls'].includes(this.#stop ?? '')) throw new Error('model_incomplete');
      text = message.content == null ? (message.refusal == null ? '' : bounded(string(message.refusal))) : bounded(string(message.content));
      calls = message.tool_calls ? array(message.tool_calls).map(raw => {
        const c = object(raw); if (c.type !== 'function') throw new Error('unsupported_model_response'); const f = object(c.function);
        return { id: string(c.id), name: string(f.name), arguments: string(f.arguments) };
      }) : [];
      if ((this.#stop === 'tool_calls') !== (calls.length > 0)) throw new Error('invalid_tool_call');
      replay = [copy({ role: 'assistant', content: text, ...(message.reasoning_content != null ? { reasoning_content: bounded(string(message.reasoning_content)) } : {}),
        ...(calls.length ? { tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}) })];
    } else if (this.#protocol === 'responses') {
      const response = this.#response; if (!response || response.status !== 'completed') throw new Error('model_incomplete');
      this.#updateUsage(response.usage);
      for (const raw of array(response.output)) {
        const item = object(raw);
        if (item.type === 'message') {
          if (item.role !== 'assistant' || item.status !== 'completed') throw new Error('model_incomplete');
          for (const rawContent of array(item.content)) {
            const c = object(rawContent);
            if (c.type === 'output_text') text += string(c.text);
            else if (c.type === 'refusal') text += string(c.refusal);
            else throw new Error('unsupported_model_response');
          }
        } else if (item.type === 'function_call') {
          if (item.status && item.status !== 'completed') throw new Error('model_incomplete');
          calls.push({ id: string(item.call_id), name: string(item.name), arguments: string(item.arguments) });
        } else if (item.type !== 'reasoning') throw new Error('unsupported_model_response');
        replay.push(copy(item)); // Preserve signed/encrypted reasoning for stateless continuation.
      }
      bounded(text);
    } else {
      const blocks = this.#response ? array(this.#response.content).map(object) : [...this.#blocks.entries()].sort(([a],[b]) => a-b).map(([,b]) => b);
      if (this.#response) { this.#stop = string(this.#response.stop_reason); this.#updateUsage(this.#response.usage); }
      if (this.#stop === 'max_tokens') throw new Error('model_output_limit');
      if (!['end_turn', 'tool_use', 'stop_sequence'].includes(this.#stop ?? '')) throw new Error('model_incomplete');
      for (const block of blocks) {
        if (block.type === 'text') text += string(block.text);
        else if (block.type === 'tool_use') calls.push({ id: string(block.id), name: string(block.name), arguments: JSON.stringify(object(block.input)) });
        else if (!['thinking', 'redacted_thinking'].includes(String(block.type))) throw new Error('unsupported_model_response');
      }
      if ((this.#stop === 'tool_use') !== (calls.length > 0)) throw new Error('invalid_tool_call');
      bounded(text); replay = [copy({ role: 'assistant', content: blocks })];
    }
    return { text, calls: callsValid(calls), replay, usage: this.#usage };
  }
}

import type { ApiSettings } from './protocol.ts';

/** Trusted, editable defaults. Applying a preset never contacts the provider. */
export const API_PRESETS: Readonly<Record<string, Partial<ApiSettings>>> = Object.freeze({
  deepseek: { protocol: 'chat', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', chatTokenField: 'max_tokens', maxTokens: 16384, timeoutSeconds: 300 },
  'openai-responses': { protocol: 'responses', endpoint: 'https://api.openai.com/v1/responses', model: '', chatTokenField: 'max_completion_tokens', maxTokens: 16384, timeoutSeconds: 300 },
  anthropic: { protocol: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', model: '', chatTokenField: 'max_tokens', maxTokens: 8192, timeoutSeconds: 300 },
  qwen: { protocol: 'chat', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: '', chatTokenField: 'max_tokens', maxTokens: 8192, timeoutSeconds: 300 },
});

export function presetFor(settings: ApiSettings): string {
  return Object.entries(API_PRESETS).find(([, preset]) => preset.endpoint === settings.endpoint && preset.protocol === settings.protocol)?.[0] ?? 'custom';
}

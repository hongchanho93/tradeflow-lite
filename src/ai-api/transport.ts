import { invoke } from '@tauri-apps/api/core';
import { TurnDecoder, type ApiSettings, type ModelTurn, type NativeFrame, type ProfileView, type ModelActivity } from './protocol.ts';
import type { JsonValue } from '../ai-capabilities/contracts.ts';

export interface ConfigureInput { settings: ApiSettings; key: string | null; remember: boolean; expectedRevision: string | null }
export interface ApiTransport {
  configure(input: ConfigureInput): Promise<ProfileView>;
  load(): Promise<ProfileView | null>;
  forget(): Promise<void>;
  turn(profile: ProfileView, payload: JsonValue, signal: AbortSignal, text: (value: string) => void, activity?: (value: ModelActivity) => void): Promise<ModelTurn>;
}
export const apiTransport: ApiTransport = {
  configure: input => invoke('ai_api_configure', { input }),
  load: () => invoke('ai_api_load'),
  forget: () => invoke('ai_api_forget'),
  async turn(profile, payload, signal, text, activity) {
    if (signal.aborted) throw new Error('cancelled');
    const requestId = crypto.randomUUID(); const decoder = new TurnDecoder(profile.settings.protocol, text, activity);
    const cancel = () => { void invoke('ai_api_cancel', { requestId }).catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await invoke('ai_api_start', { requestId, profileRevision: profile.revision, payload });
      // Abort may precede native registration; always cancel again after start.
      if (signal.aborted) throw new Error('cancelled');
      while (true) {
        const frame = await invoke<NativeFrame>('ai_api_next', { requestId });
        if (signal.aborted) throw new Error('cancelled');
        decoder.consume(frame); if (frame.kind === 'done') break;
      }
      return decoder.finish();
    } finally { signal.removeEventListener('abort', cancel); cancel(); }
  },
};

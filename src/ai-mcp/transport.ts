import { Channel, invoke } from '@tauri-apps/api/core';

export interface McpConfiguration { readonly serverId: string; readonly port: number; readonly token: string; readonly executable: string; readonly runtimeFile: string }
export interface McpBridgeEvent { readonly serverId: string; readonly connectionId: string;
  readonly kind: 'opened' | 'message' | 'closed'; readonly sequence: number; readonly message: string | null }
export interface McpTransport {
  enabled(): Promise<boolean>;
  start(receive: (event: McpBridgeEvent) => void, remember?: boolean): Promise<McpConfiguration>;
  stop(serverId: string, disable?: boolean): Promise<void>;
  resetCredentials(): Promise<void>;
  finish(event: McpBridgeEvent, response: string | null): Promise<void>;
  toolsChanged?(serverId: string, connectionId: string): Promise<void>;
  disconnect(serverId: string, connectionId: string): Promise<void>;
}

export const desktopMcpTransport: McpTransport = {
  enabled: () => invoke('ai_mcp_enabled'),
  start(receive, remember = true) {
    const channel = new Channel<McpBridgeEvent>();
    channel.onmessage = receive;
    return invoke('ai_mcp_start', { channel, remember });
  },
  stop: (serverId, disable = false) => invoke('ai_mcp_stop', { serverId, disable }),
  resetCredentials: () => invoke('ai_mcp_reset_credentials'),
  finish: (event, response) => invoke('ai_mcp_finish', {
    serverId: event.serverId, connectionId: event.connectionId, sequence: event.sequence, response,
  }),
  disconnect: (serverId, connectionId) => invoke('ai_mcp_disconnect', { serverId, connectionId }),
  toolsChanged: (serverId, connectionId) => invoke('ai_mcp_tools_changed', { serverId, connectionId }),
};

/** Explicit user copy only. Never place this object in tool replies or logs. */
export function formatMcpConfiguration(config: McpConfiguration, format: 'codex' | 'json'): string {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535
    || !/^[0-9a-f]{64}$/.test(config.token) || !config.executable || /[\x00-\x1f\x7f]/.test(config.executable)
    || !config.runtimeFile || config.runtimeFile.length > 4096 || /[\x00-\x1f\x7f]/.test(config.runtimeFile)) {
    throw new Error('invalid local MCP configuration');
  }
  const env = { TRADEFLOW_MCP_RUNTIME_FILE: config.runtimeFile, TRADEFLOW_MCP_PORT: String(config.port), TRADEFLOW_MCP_TOKEN: config.token };
  if (format === 'codex') return [
    '[mcp_servers.tradeflow_lite]', `command = ${JSON.stringify(config.executable)}`,
    'args = ["--mcp-stdio"]', 'tool_timeout_sec = 150', '', '[mcp_servers.tradeflow_lite.env]',
    ...Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
  ].join('\n');
  return JSON.stringify({ mcpServers: { tradeflow_lite: { type: 'stdio', command: config.executable, args: ['--mcp-stdio'], env } } }, null, 2);
}

import { McpConnection, type McpHost } from './session.ts';
import { desktopMcpTransport, formatMcpConfiguration, type McpBridgeEvent, type McpConfiguration, type McpTransport } from './transport.ts';

/** The native pairing token is the user's authorization for this local MCP endpoint.
 * After authenticated MCP initialization, business access is automatic. */
export class AiMcpController {
  readonly #panel: HTMLElement;
  readonly #toggle: HTMLElement;
  readonly #host: McpHost;
  readonly #transport: McpTransport;
  readonly #connections = new Map<string, McpConnection>();
  #configuration?: McpConfiguration;
  #busy = false;
  #renderQueued = false;
  #rendered = '';
  #status = '本地连接未启用';
  #generation = 0;

  constructor(panel: HTMLElement, toggle: HTMLElement, host: McpHost, transport = desktopMcpTransport) {
    this.#panel = panel; this.#toggle = toggle; this.#host = host; this.#transport = transport;
    this.#get<HTMLButtonElement>('#ai-mcp-start').addEventListener('click', () => void this.start());
    this.#get<HTMLButtonElement>('#ai-mcp-stop').addEventListener('click', () => void this.stop());
    this.#get<HTMLButtonElement>('#ai-mcp-reset').addEventListener('click', () => void this.resetCredentials());
    this.#get<HTMLButtonElement>('#ai-mcp-copy').addEventListener('click', () => void this.#copy());
    this.#render();
    void this.#restore();
  }
  #get<T extends HTMLElement>(selector: string): T { return this.#panel.querySelector<T>(selector)!; }
  #scheduleRender = () => {
    if (this.#renderQueued) return;
    this.#renderQueued = true;
    queueMicrotask(() => { this.#renderQueued = false; this.#render(); });
  };
  async #restore(): Promise<void> {
    try { if (await this.#transport.enabled()) await this.start(false); }
    catch { this.#status = 'MCP 自动恢复失败，可手动重新启用'; this.#render(); }
  }
  async start(remember = true): Promise<void> {
    if (this.#busy || this.#configuration) return;
    this.#busy = true; this.#status = '正在启用本地连接'; this.#render();
    const generation = ++this.#generation;
    try {
      const config = await this.#transport.start(event => {
        if (generation === this.#generation) void this.#receive(event);
      }, remember);
      if (generation !== this.#generation) { await this.#transport.stop(config.serverId, false); return; }
      formatMcpConfiguration(config, 'json'); // Validate before displaying a usable state.
      this.#configuration = config; this.#status = '本地 MCP 已启用';
    } catch { this.#status = '本地 MCP 启动失败，请使用最新桌面开发版'; }
    finally { this.#busy = false; this.#render(); }
  }
  async stop(): Promise<void> {
    if (this.#busy || !this.#configuration) return;
    this.#busy = true;
    const config = this.#configuration;
    for (const c of this.#connections.values()) c.close();
    this.#connections.clear(); this.#status = '正在停止 MCP'; this.#render();
    try {
      await this.#transport.stop(config.serverId, true);
      this.#configuration = undefined; this.#generation++; this.#status = '本地 MCP 已停止';
    } catch { this.#status = '停止 MCP 未获确认，请重试'; }
    finally { this.#busy = false; this.#render(); }
  }
  async resetCredentials(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true; this.#status = '正在重置 MCP 连接凭证'; this.#render();
    const config = this.#configuration;
    try {
      const enabled = await this.#transport.enabled();
      for (const connection of this.#connections.values()) connection.close();
      this.#connections.clear();
      if (config) await this.#transport.stop(config.serverId, false);
      this.#configuration = undefined; this.#generation++;
      await this.#transport.resetCredentials();
      this.#status = 'MCP 连接凭证已重置，请重新复制一次配置';
      this.#busy = false; this.#render();
      if (enabled) await this.start(false);
      return;
    } catch { this.#status = '重置 MCP 连接凭证失败，请重试'; }
    finally { if (this.#busy) { this.#busy = false; this.#render(); } }
  }
  invalidate(): void { for (const c of this.#connections.values()) c.invalidate(); }
  async #copy(): Promise<void> {
    if (!this.#configuration || this.#busy) return;
    const format = this.#get<HTMLSelectElement>('#ai-mcp-client-format').value === 'codex' ? 'codex' : 'json';
    try {
      await navigator.clipboard.writeText(formatMcpConfiguration(this.#configuration, format));
      this.#status = '连接配置已复制，请粘贴到外部客户端的 MCP 设置';
    } catch { this.#status = '复制失败，请检查剪贴板权限'; }
    this.#render();
  }
  async #receive(event: McpBridgeEvent): Promise<void> {
    if (!this.#configuration || event.serverId !== this.#configuration.serverId) return;
    if (event.kind === 'opened') {
      // Process-safety ceiling only; ordinary users should never encounter it.
      if (this.#connections.size >= 64 || this.#connections.has(event.connectionId) || this.#busy) {
        await this.#transport.disconnect(event.serverId, event.connectionId).catch(() => {}); return;
      }
      const toolsChanged = this.#transport.toolsChanged;
      const connection = new McpConnection(this.#host, this.#scheduleRender, toolsChanged ? {
        toolsChanged: async () => {
          if (this.#configuration?.serverId !== event.serverId || this.#connections.get(event.connectionId) !== connection) return;
          try { await toolsChanged(event.serverId, event.connectionId); }
          catch {
            connection.close();
            if (this.#connections.get(event.connectionId) === connection) this.#connections.delete(event.connectionId);
            await this.#transport.disconnect(event.serverId, event.connectionId).catch(() => {});
            this.#scheduleRender();
          }
        },
      } : {});
      this.#connections.set(event.connectionId, connection);
      this.#scheduleRender(); return;
    }
    const connection = this.#connections.get(event.connectionId);
    if (event.kind === 'closed') {
      connection?.close(); this.#connections.delete(event.connectionId);
      this.#scheduleRender(); return;
    }
    if (event.kind !== 'message' || typeof event.message !== 'string') return;
    let response: string | null = null;
    try {
      if (connection) {
        const before = connection.view();
        if (before.ready && before.access === 'pending') { try { connection.authorize('workbench'); } catch {} }
        response = await connection.receive(event.message);
        const after = connection.view();
        if (after.ready && after.access === 'pending') { try { connection.authorize('workbench'); } catch {} }
      }
    }
    catch { connection?.revoke(); }
    try { await this.#transport.finish(event, response); }
    catch {
      connection?.close();
      if (this.#connections.get(event.connectionId) === connection) this.#connections.delete(event.connectionId);
      await this.#transport.disconnect(event.serverId, event.connectionId).catch(() => {});
      this.#scheduleRender();
    }
  }
  #render(): void {
    const start = this.#get<HTMLButtonElement>('#ai-mcp-start');
    const stop = this.#get<HTMLButtonElement>('#ai-mcp-stop');
    const reset = this.#get<HTMLButtonElement>('#ai-mcp-reset');
    start.hidden = !!this.#configuration; start.disabled = this.#busy;
    stop.hidden = !this.#configuration; stop.disabled = this.#busy;
    reset.hidden = !this.#configuration; reset.disabled = this.#busy;
    this.#get('#ai-mcp-configuration').hidden = !this.#configuration;
    this.#get<HTMLButtonElement>('#ai-mcp-copy').disabled = this.#busy;
    this.#get('#ai-mcp-status').textContent = this.#status;
    const rows = [...this.#connections].map(([id, c]) => ({ id, view: c.view() }));
    this.#toggle.dataset.pending = 'false';
    this.#get('#ai-mcp-empty').hidden = rows.length > 0;
    // Ignore changing task counters so routine reads do not replace a focused form.
    const signature = JSON.stringify(rows.map(r => ({ id: r.id, ...r.view, active: 0 })));
    if (signature === this.#rendered) return;
    this.#rendered = signature;
    const container = this.#get('#ai-mcp-connections');
    const fragment = document.createDocumentFragment();
    for (const { id, view } of rows) {
      const connection = this.#connections.get(id)!;
      const card = document.createElement('section'); card.className = 'ai-connection'; card.dataset.connectionId = id;
      const title = document.createElement('strong'); title.textContent = view.name; title.className = 'ai-external-text';
      const states = { pending: '正在连接', authorized: '已连接', stale: '正在同步当前图表', revoked: '连接不可用', closed: '已断开' };
      const status = document.createElement('p'); status.textContent = states[view.access];
      card.append(title, status);
      const actions = document.createElement('div'); actions.className = 'ai-actions';
      const disconnect = this.#button('断开', () => {
        connection.close();
        void this.#transport.disconnect(this.#configuration!.serverId, id).catch(() => {
          this.#status = '断开连接未获确认，请停止本地服务'; this.#render();
        });
      });
      actions.append(disconnect); card.append(actions);
      fragment.append(card);
    }
    container.replaceChildren(fragment);
  }
  #button(text: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.addEventListener('click', action); return button;
  }
}

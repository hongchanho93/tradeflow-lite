import type { McpHost } from '../ai-mcp/session.ts';
import { approvalOverview } from '../ai-mcp/approval.ts';
import { translateUiText } from '../i18n.ts';
import { ApiConversation } from './conversation.ts';
import { apiTransport, type ApiTransport } from './transport.ts';
import type { ApiSettings, ProfileView } from './protocol.ts';
import { API_ERRORS } from './strings.ts';
import { API_PRESETS, presetFor } from './presets.ts';
import { AiConversationHistoryStore, type AiConversationSummary } from './history.ts';

export class AiApiController {
  readonly #root: HTMLElement; readonly #tab: HTMLElement; readonly #transport: ApiTransport;
  readonly #conversation: ApiConversation; readonly #history?: AiConversationHistoryStore;
  #profile?: ProfileView; #busy = false; #dirty = true;
  #timer?: ReturnType<typeof setTimeout>; #historyTimer?: ReturnType<typeof setTimeout>; #renderedMessages = ''; #renderedApprovals = '';
  #renderedHistory = '';
  #status = '尚未配置 API'; #chatError = '';
  #historyError = ''; #historyRows: readonly AiConversationSummary[] = [];
  #conversationId: string = crypto.randomUUID(); #conversationCreatedAt = Date.now();
  readonly #settingsErrors = new Set([
    'authentication_failed','access_denied','endpoint_or_model_missing','provider_rejected_request',
    'invalid_configuration','invalid_endpoint','insecure_endpoint','api_key_required','invalid_api_key',
    'endpoint_change_requires_key','secure_storage_unavailable','secure_storage_capacity','secure_storage_invalid',
  ]);
  constructor(root: HTMLElement, tab: HTMLElement, host: McpHost, transport = apiTransport, history?: AiConversationHistoryStore) {
    this.#root = root; this.#tab = tab; this.#transport = transport; this.#history = history;
    this.#conversation = new ApiConversation(host, transport, () => { this.#schedule(); this.#scheduleHistoryPersist(); });
    this.#get<HTMLFormElement>('api-config-form').addEventListener('submit', e => { e.preventDefault(); void this.#save(); });
    this.#get('api-config-form').addEventListener('input', () => { this.#dirty = true; this.#status = '配置有修改，保存后生效'; this.#render(); });
    this.#get('api-preset').addEventListener('change', () => this.#preset());
    this.#get('api-send').addEventListener('click', () => void this.#send());
    this.#get('api-cancel').addEventListener('click', () => this.#cancel());
    for (const id of ['api-settings-open', 'api-error-settings']) this.#get(id).addEventListener('click', () => this.#showSettings(true));
    this.#get('api-connect').addEventListener('click', () => { if (!this.#busy && !this.#conversation.view().busy) this.#showSettings(true); });
    this.#get('api-settings-back').addEventListener('click', () => this.#showSettings(false));
    this.#get('api-resume').addEventListener('click', () => void this.#resume());
    this.#get('api-new-chat').addEventListener('click', () => void this.#newChat());
    this.#get('api-history-open').addEventListener('click', () => void this.#openHistoryPage());
    this.#get('api-history-back').addEventListener('click', () => this.#showHistory(false));
    this.#get('api-prompt').addEventListener('keydown', e => {
      const event = e as KeyboardEvent;
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); void this.#send(); }
    });
    this.#get('api-prompt').addEventListener('input', () => { this.#resizePrompt(); this.#render(); });
    this.#preset(); this.#status = '尚未配置 API';
    this.#render();
    void this.#refreshHistory();
    // Load this application's single OS-stored connection, never model history
    // or chart grants. No network calls are made until an explicit user action.
    void this.#load();
  }
  #showSettings(open: boolean): void {
    const taskPage = this.#root.querySelector<HTMLElement>('#user-task-page'); if (taskPage) taskPage.hidden = true;
    this.#get('api-history-page').hidden = true;
    this.#get('api-settings-page').hidden = !open; this.#get('api-chat-page').hidden = open;
    this.#render(); this.#get(open ? 'api-preset' : 'api-prompt').focus();
  }
  #showHistory(open: boolean): void {
    const taskPage = this.#root.querySelector<HTMLElement>('#user-task-page'); if (taskPage) taskPage.hidden = true;
    this.#get('api-settings-page').hidden = true;
    this.#get('api-history-page').hidden = !open;
    this.#get('api-chat-page').hidden = open;
    this.#render();
    this.#get(open ? 'api-history-list' : 'api-prompt').focus();
  }
  #resizePrompt(): void {
    const prompt = this.#get<HTMLTextAreaElement>('api-prompt');
    prompt.style.height = '82px'; prompt.style.height = `${Math.min(180, Math.max(82, prompt.scrollHeight))}px`;
  }
  #get<T extends HTMLElement = HTMLElement>(id: string): T { return this.#root.querySelector<T>(`#${id}`)!; }
  #t(text: string): string { return translateUiText(text, document.documentElement.lang === 'en-US' ? 'en-US' : 'zh-CN'); }
  #error(error: unknown): string {
    const code = error instanceof Error ? error.message : String(error);
    return this.#t(API_ERRORS[code] ?? '操作未完成。请检查配置后重试；没有自动重试或切换服务。');
  }
  #schedule(): void { this.#timer ??= setTimeout(() => { this.#timer = undefined; this.#render(); }, 40); }
  #scheduleHistoryPersist(): void {
    if (!this.#history || this.#historyTimer) return;
    this.#historyTimer = setTimeout(() => {
      this.#historyTimer = undefined;
      void this.#persistCurrent(false);
    }, 1000);
  }
  #settings(): ApiSettings {
    const value = (id: string) => this.#get<HTMLInputElement>(id).value;
    const checked = (id: string) => this.#get<HTMLInputElement>(id).checked;
    return { protocol: value('api-protocol') as ApiSettings['protocol'], endpoint: value('api-endpoint').trim(), model: value('api-model').trim(),
      stream: checked('api-stream'), tools: true, includeUsage: checked('api-usage'), chatTokenField: value('api-token-field') as ApiSettings['chatTokenField'],
      maxTokens: Number(value('api-max-tokens')), timeoutSeconds: Number(value('api-timeout')), allowLocalHttp: checked('api-local-http') };
  }
  #apply(view: ProfileView | null): void {
    this.#profile = view ?? undefined; this.#dirty = !view || !view.settings.tools; this.#conversation.reset(this.#profile);
    this.#conversationId = crypto.randomUUID(); this.#conversationCreatedAt = Date.now();
    this.#chatError = ''; this.#get<HTMLInputElement>('api-key').value = '';
    if (!view) return;
    for (const [id, key] of [['api-protocol','protocol'],['api-endpoint','endpoint'],['api-model','model'],['api-token-field','chatTokenField'],['api-max-tokens','maxTokens'],['api-timeout','timeoutSeconds']] as const) this.#get<HTMLInputElement>(id).value = String(view.settings[key]);
    for (const [id, key] of [['api-stream','stream'],['api-usage','includeUsage'],['api-local-http','allowLocalHttp']] as const) this.#get<HTMLInputElement>(id).checked = view.settings[key];
    this.#get<HTMLInputElement>('api-no-key').checked = !view.hasKey;
    this.#get<HTMLSelectElement>('api-preset').value = presetFor(view.settings);
    this.#modelOptions();
    this.#status = '已配置';
    if (!view.settings.tools) this.#status = '旧连接需重新保存，以启用完整图表助手。';
    this.#get<HTMLDetailsElement>('api-settings').open = false;
  }
  #preset(): void {
    const p = this.#get<HTMLSelectElement>('api-preset').value;
    const preset = API_PRESETS[p];
    if (preset) {
      for (const [id, key] of [['api-protocol','protocol'],['api-endpoint','endpoint'],['api-model','model'],['api-token-field','chatTokenField'],['api-max-tokens','maxTokens'],['api-timeout','timeoutSeconds']] as const) this.#get<HTMLInputElement>(id).value = String(preset[key]);
      this.#get<HTMLInputElement>('api-key').value = '';
      this.#get<HTMLInputElement>('api-no-key').checked = false;
      this.#get<HTMLInputElement>('api-local-http').checked = false;
    }
    this.#modelOptions(); this.#get<HTMLDetailsElement>('api-settings').open = p === 'custom';
    this.#dirty = true; this.#status = '配置有修改，保存后生效'; this.#render();
  }
  #modelOptions(): void {
    const model = API_PRESETS[this.#get<HTMLSelectElement>('api-preset').value]?.model;
    const options: HTMLOptionElement[] = [];
    if (model) { const option = document.createElement('option'); option.value = model; options.push(option); }
    this.#get('api-model-options').replaceChildren(...options);
  }
  async #save(): Promise<void> {
    if (this.#busy || this.#conversation.view().busy) return;
    if (!this.#dirty && this.#profile) { this.#showSettings(false); return; }
    this.#busy = true; this.#status = '正在保存配置'; this.#render();
    const keyInput = this.#get<HTMLInputElement>('api-key');
    const key = this.#get<HTMLInputElement>('api-no-key').checked ? '' : keyInput.value.trim() || null; keyInput.value = '';
    try { await this.#persistCurrent(); this.#apply(await this.#transport.configure({ settings: this.#settings(), key,
      remember: true, expectedRevision: this.#profile?.revision ?? null })); this.#showSettings(false); }
    catch (e) { this.#dirty = true; this.#status = this.#error(e); }
    finally { this.#busy = false; this.#render(); }
  }
  async #load(): Promise<void> {
    if (this.#busy || this.#conversation.view().busy) return;
    this.#busy = true; this.#status = '正在恢复已保存连接'; this.#render();
    try { const profile = await this.#transport.load(); this.#apply(profile); if (!profile) this.#status = '尚未配置 API'; }
    catch (e) { this.#status = this.#error(e); } finally { this.#busy = false; this.#render(); }
  }
  #configured(): boolean { return !!this.#profile; }
  #cancel(): void { this.#conversation.cancel(); void this.#persistCurrent(); }
  invalidate(): void { this.#conversation.invalidate(); this.#render(); }
  /** Host UI handoff only: preserve the user's unsent text; never auto-send. */
  draftMessage(message: string): void {
    const prompt = this.#get<HTMLTextAreaElement>('api-prompt');
    const text = prompt.value.trim() ? `${prompt.value}\n\n${message}` : message;
    if (text.length > 16000) throw new Error('data_composer_full');
    prompt.value = text; this.#showSettings(false); this.#resizePrompt(); this.#render(); prompt.focus();
  }
  async #resume(): Promise<void> {
    if (!this.#configured() || this.#busy || this.#conversation.view().busy) return;
    this.#chatError = '';
    try { await this.#conversation.resume(); await this.#persistCurrent(); } catch (e) { this.#chatError = this.#error(e); }
    this.#render();
  }
  async #send(): Promise<void> {
    const view = this.#conversation.view();
    if (!this.#configured() || this.#busy || view.busy) return;
    const prompt = this.#get<HTMLTextAreaElement>('api-prompt'); const text = prompt.value; if (!text.trim()) return; prompt.value = '';
    this.#chatError = ''; this.#resizePrompt();
    try { await this.#conversation.send(text); await this.#persistCurrent(); }
    catch (e) { if (!prompt.value) prompt.value = text; this.#chatError = this.#error(e); this.#resizePrompt(); } this.#render();
  }
  async #newChat(): Promise<void> {
    this.#cancel();
    await this.#persistCurrent();
    this.#conversationId = crypto.randomUUID(); this.#conversationCreatedAt = Date.now();
    this.#conversation.reset(this.#profile); this.#chatError = ''; this.#historyError = ''; this.#showHistory(false);
    this.#get('api-prompt').focus();
  }
  #conversationTitle(): string {
    const message = this.#conversation.view().messages.find(item => item.role === 'user' && item.text.trim());
    const normalized = message?.text.replace(/\s+/g, ' ').trim() ?? '';
    return normalized ? normalized.slice(0, 80) : '新对话';
  }
  async #persistCurrent(refresh = true): Promise<void> {
    if (!this.#history) return;
    const snapshot = this.#conversation.snapshot();
    if (!snapshot.messages.some(message => message.role === 'user' && message.text.trim())) return;
    try {
      await this.#history.save({
        id: this.#conversationId, title: this.#conversationTitle(), createdAt: this.#conversationCreatedAt,
        updatedAt: Date.now(), snapshot,
      });
      this.#historyError = ''; if (refresh) await this.#refreshHistory(false);
    } catch {
      this.#historyError = '对话历史未能保存到本机';
    }
  }
  async #refreshHistory(render = true): Promise<void> {
    if (!this.#history) { this.#historyRows = []; if (render) this.#render(); return; }
    try { this.#historyRows = await this.#history.list(); this.#historyError = ''; }
    catch { this.#historyRows = []; this.#historyError = '对话历史读取失败'; }
    if (render) this.#render();
  }
  async #openHistoryPage(): Promise<void> {
    await this.#persistCurrent(); await this.#refreshHistory(false); this.#showHistory(true);
  }
  async #openConversation(id: string): Promise<void> {
    if (!this.#history || this.#busy || this.#conversation.view().busy) return;
    await this.#persistCurrent();
    try {
      const record = await this.#history.load(id);
      if (!record) { this.#historyError = '这条历史对话已不可用'; await this.#refreshHistory(false); this.#render(); return; }
      this.#conversationId = record.id; this.#conversationCreatedAt = record.createdAt;
      this.#conversation.restore(this.#profile, record.snapshot);
      this.#chatError = ''; this.#historyError = ''; this.#showHistory(false); this.#get('api-prompt').focus();
    } catch { this.#historyError = '历史对话打开失败'; this.#render(); }
  }
  #render(): void {
    const view = this.#conversation.view(); const busy = this.#busy || view.busy;
    this.#root.dataset.runState = view.status; this.#root.dataset.runFailed = String(view.failed);
    this.#root.dataset.runBusy = String(busy); this.#get('api-messages').setAttribute('aria-busy', String(view.busy));
    this.#get('api-config-status').textContent = this.#t(this.#status);
    this.#get('api-model-label').textContent = this.#profile?.settings.model ?? this.#t('尚未连接 AI');
    this.#get('api-empty').hidden = view.messages.length > 0;
    this.#get('api-connect').hidden = this.#configured();
    this.#get('api-connect').textContent = this.#t('连接 AI');
    this.#get<HTMLButtonElement>('api-connect').disabled = busy;
    this.#get('api-empty-hint').textContent = this.#configured() ? this.#t('直接提问，或让我读取图表、计算和绘图。') : this.#t('连接你的 AI 服务后，即可开始对话。');
    this.#get<HTMLInputElement>('api-key').placeholder = this.#t(this.#profile?.hasKey
      ? 'Key 已保留，无需重填；留空保持不变' : '粘贴 API Key；已连接时留空可保留');
    for (const control of this.#get('api-config-form').querySelectorAll<HTMLInputElement>('input,select,button')) control.disabled = busy;
    this.#get<HTMLButtonElement>('api-send').disabled = busy || !this.#configured() || !this.#get<HTMLTextAreaElement>('api-prompt').value.trim();
    this.#get<HTMLButtonElement>('api-cancel').disabled = !view.busy;
    this.#get('api-cancel').hidden = !view.busy;
    this.#get('api-send').hidden = view.busy;
    this.#get('api-resume').hidden = !view.canResume || busy;
    this.#get<HTMLButtonElement>('api-resume').disabled = !this.#configured();
    this.#get('api-error-settings').hidden = !view.failed || !this.#settingsErrors.has(view.status);
    const status: Record<string, string> = { idle: '', requesting: '正在等待模型…', thinking: 'AI 正在思考…', receiving: '正在回复…', tool_running: '正在执行工具', completed: '',
      chart_changed: '已切换图表，当前对话已保留；下一条消息会使用新图表。' };
    this.#get('api-run-status').textContent = view.approvals.length ? this.#t('等待你确认图表修改') : view.failed
      ? `${this.#error(view.status)} ${this.#t(view.canResume ? '记录已保留。可手动继续，不会重复执行已完成的绘图；重新请求可能计费。' : '记录已保留。可检查设置或新建对话；已提交的绘图不会自动撤销。')}`
      : this.#chatError || this.#historyError || (view.messages.length && !this.#configured() ? this.#t('发送前请先保存 AI 配置。')
        : view.notice ? this.#error(view.notice) : this.#t(status[view.status] ?? ''));
    this.#tab.dataset.apiPending = String(view.approvals.length > 0);
    const signature = JSON.stringify(view.messages);
    if (signature !== this.#renderedMessages) {
      this.#renderedMessages = signature; const list = this.#get('api-transcript'); const follow = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
      this.#get('api-messages').replaceChildren(...view.messages.map(m => {
        const el = document.createElement('div'); el.className = 'api-message'; el.dataset.role = m.role;
        if (m.incomplete) { el.dataset.incomplete = 'true'; el.dataset.interruptedLabel = this.#t('此段回复未完成'); }
        const names: Record<string,string> = { tf_ai_help:'读取能力说明', tf_context_get:'读取图表上下文', tf_chart_snapshot:'读取图表数据', tf_dataset_page:'读取数据分页',
          tf_compute_summary:'区间统计', tf_compute_sma:'计算均线', tf_drawings_types:'读取绘图类型', tf_drawings_propose:'生成绘图方案',
          tf_drawings_apply:'应用绘图', tf_drawings_revert:'撤销本次绘图', tf_drawings_apply_existing:'修改已有绘图',
          tf_drawings_remove_owned:'清理本次会话绘图',
          tf_drawings_revert_saved:'撤销历史绘图', tf_drawings_list:'读取已有绘图', tf_drawings_history:'读取绘图记录', tf_dataset_release:'释放数据快照',
          tf_market_providers:'读取行情源', tf_market_provider:'读取行情源详情', tf_market_catalog:'读取品种目录', tf_market_search:'搜索品种',
          tf_market_history:'查询独立历史行情', tf_market_page:'读取行情结果分页', tf_market_release:'释放行情结果', tf_market_quote:'查询品种报价', tf_market_quotes:'批量查询报价',
          tf_watchlist_list:'读取自选列表', tf_watchlist_quotes:'查询自选报价', tf_watchlist_add:'加入自选', tf_watchlist_remove:'移出自选', tf_watchlist_move:'调整自选顺序',
          tf_chart_current:'读取当前图表', tf_chart_open:'打开品种', tf_chart_resolution:'切换周期', tf_chart_adjustment:'切换复权', tf_chart_visible_range:'读取可见范围', tf_chart_data_window:'读取数据窗口',
          tf_indicator_definitions:'读取指标定义', tf_indicator_instances:'读取当前指标', tf_indicator_library:'读取用户指标库',
          tf_indicator_add:'添加指标', tf_indicator_remove:'移除指标', tf_indicator_inputs_get:'读取指标参数', tf_indicator_inputs_set:'修改指标参数', tf_indicator_visibility:'调整指标显示', tf_indicator_retry:'重试指标',
          tf_indicator_guide:'读取指标编写说明', tf_indicator_source:'读取指定用户指标源码', tf_indicator_validate:'验证用户指标', tf_indicator_test:'预运行用户指标', tf_indicator_install:'保存用户指标', tf_indicator_library_remove:'删除用户指标' };
        const name = m.text.split(' ')[0];
        const title = names[name] ?? m.toolTitle;
        if (m.role === 'tool' && title) {
          const code = m.text.split(' · ')[1];
          el.textContent = `${this.#t(title)} ${code === undefined ? '…' : `· ${code === 'ok' ? this.#t('完成') : this.#error(code)}`}`;
        } else el.textContent = m.text || '…';
        return el;
      }));
      if (follow) list.scrollTop = list.scrollHeight;
    }
    const approvals = JSON.stringify(view.approvals);
    if (approvals !== this.#renderedApprovals) {
      this.#renderedApprovals = approvals;
      this.#get('api-approvals').replaceChildren(...view.approvals.map(a => {
        const section = document.createElement('section'); section.className = 'ai-approval';
        const p = document.createElement('p'); p.className = 'ai-external-text ai-approval-overview'; p.textContent = approvalOverview(a, document.documentElement.lang === 'en-US').join('\n\n');
        const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = this.#t('查看完整操作');
        const pre = document.createElement('pre'); pre.className = 'ai-external-text'; pre.textContent = JSON.stringify(a, null, 2); details.append(summary, pre);
        const accept = document.createElement('button'); accept.type = 'button'; accept.dataset.apiAction = 'approve'; accept.textContent = this.#t('确认应用');
        accept.addEventListener('click', () => this.#conversation.approve(a.id, true));
        const deny = document.createElement('button'); deny.type = 'button'; deny.dataset.apiAction = 'deny'; deny.textContent = this.#t('拒绝');
        deny.addEventListener('click', () => this.#conversation.approve(a.id, false)); section.append(p, details, accept, deny); return section;
      }));
    }
    const historySignature = JSON.stringify(this.#historyRows);
    if (historySignature !== this.#renderedHistory) {
      this.#renderedHistory = historySignature;
      this.#get('api-history-empty').hidden = this.#historyRows.length > 0;
      this.#get('api-history-list').replaceChildren(...this.#historyRows.map(row => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'api-history-row';
        const main = document.createElement('span'); main.className = 'api-history-row-main';
        const title = document.createElement('span'); title.className = 'api-history-title'; title.textContent = row.title;
        const time = document.createElement('span'); time.className = 'api-history-time';
        time.textContent = new Date(row.updatedAt).toLocaleString(document.documentElement.lang || undefined);
        main.append(title, time); button.append(main); button.addEventListener('click', () => void this.#openConversation(row.id)); return button;
      }));
    }
  }
}

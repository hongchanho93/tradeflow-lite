import { CapabilityError, type AsyncToolTransaction, type JsonValue, type ToolExecutionContext, type ToolSessionScope, type ToolTransaction, type ValueSchema } from '../ai-capabilities/contracts.ts';
import { parseJson } from '../ai-capabilities/json.ts';
import { TASK_LIMITS, TaskError, object, taskParameters, taskSymbol, type TaskSymbol } from './contracts.ts';
import { UserTaskManager, type ValidatedTask, type TaskStart } from './manager.ts';
import type { UserTaskLibrary } from './library.ts';
import type { ResultPage } from './results.ts';
import { TASK_EXAMPLE } from './guide.ts';
import { TASK_STATES, taskText as t, taskUserError } from './strings.ts';
import { renderTaskResult, type TaskSymbolRoute } from './viewer.ts';

export interface TaskUiSource {
  providerId: string; name: string; venues: readonly string[]; kinds: readonly string[];
  resolutions: readonly string[]; adjustments: readonly string[]; local: boolean;
  catalogScope: 'loaded-symbols' | 'provider-catalog' | 'connector-catalog';
}
export interface UserTaskUiHost {
  manager(): UserTaskManager; library(): UserTaskLibrary;
  sources(): Promise<readonly TaskUiSource[]>; watchlist(): readonly TaskSymbol[]; appInstanceId(): string;
  /** Fills the existing composer; never starts a model request. */
  compose(text: string): void;
  prepareOpen(symbol: TaskSymbol, context: ToolExecutionContext): Promise<AsyncToolTransaction>;
  prepareWatchlist(symbols: readonly TaskSymbol[], context: ToolExecutionContext): ToolTransaction | Promise<ToolTransaction>;
  download?(filename: string, content: string, mime: string): void;
}
type RunStatus = ReturnType<UserTaskManager['status']>;
type Card = { element: HTMLElement; title: HTMLElement; progress: HTMLProgressElement; detail: HTMLElement; stop: HTMLButtonElement; save: HTMLButtonElement };
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const e = document.createElement(tag); e.textContent = text; return e; };
const isFinal = (state: string) => ['completed','cancelled','failed'].includes(state);
const localized = (zh: string, en: string) => document.documentElement.lang === 'en-US' ? en : zh;

/** Thin ordinary-user UI: all computation, storage and app mutations use shared host ports. */
export class UserTaskController {
  readonly #root: HTMLElement; readonly #host: UserTaskUiHost; readonly #lifetime = new AbortController(); readonly #owner: ToolSessionScope;
  readonly #cards = new Map<string, Card>(); readonly #parameterReaders = new Map<string, () => JsonValue | undefined>();
  #sources: readonly TaskUiSource[] = []; #subscriptions: (() => void)[] = []; #initializing?: Promise<void>;
  #preview?: ValidatedTask; #definitionSignal?: AbortSignal; #abort?: AbortController;
  #busy = false; #closed = false; #status = ''; #libraryRevision = '';
  #selected?: string; #selectedState?: string; #page?: ResultPage; #offset = 0; #previousOffsets: number[] = [];
  constructor(root: HTMLElement, host: UserTaskUiHost) {
    this.#root = root; this.#host = host; this.#owner = host.manager().createLocalSession(this.#lifetime.signal);
    this.#click('api-task-open', () => { this.#show(true); void this.initialize(); });
    this.#click('user-task-back', () => this.#show(false));
    this.#click('user-task-import', () => this.#get<HTMLInputElement>('user-task-file').click());
    this.#click('user-task-abort', () => this.#abort?.abort());
    this.#click('user-task-example', () => { void this.#run('正在检查任务文件', signal => this.#validate(TASK_EXAMPLE, signal)); });
    this.#click('user-task-ai', () => this.#draft(localized(
      '请先读取 tf.task.guide，并查询实际可用的数据源和周期，再帮助我生成用户任务 .tft。请先让我描述计算目标，不要直接替我运行参考策略。参数名称用中文。不能把已加载品种当作全市场，也不能把短窗口当作完整历史。',
      'Read tf.task.guide and the available data sources/periods, then help me create a .tft task. Ask for my research goal before running anything. Use readable parameter names. Do not confuse loaded symbols with a full-market universe or short windows with full history.')));
    this.#click('user-task-data', () => {
      this.#show(false); this.#root.querySelector<HTMLButtonElement>('#api-settings-open')?.click();
      const details = this.#root.querySelector<HTMLDetailsElement>('#user-data-settings');
      if (details) { details.open = true; details.dispatchEvent(new Event('toggle')); }
    });
    this.#click('user-task-refresh-sources', () => { void this.#run('正在刷新数据列表', async signal => {
      const sources = await this.#host.sources(); this.#check(signal); this.#sources = sources; this.#fillSources(); return '数据列表已更新。';
    }); });
    this.#click('user-task-dismiss', () => { if (!this.#busy) { this.#preview = undefined; this.#definitionSignal = undefined; this.#render(); } });
    this.#click('user-task-start', () => this.#start());
    this.#get('user-task-source').addEventListener('change', () => { this.#fillVenues(); this.#fillCandidates(); });
    this.#get('user-task-universe').addEventListener('change', () => this.#fillCandidates());
    this.#get('user-task-artifact').addEventListener('change', () => { this.#offset = 0; this.#previousOffsets = []; this.#fillSort(); this.#refreshResult(); });
    this.#click('user-task-refresh-result', () => this.#refreshResult());
    this.#click('user-task-apply-filter', () => { this.#offset = 0; this.#previousOffsets = []; this.#refreshResult(); });
    this.#click('user-task-prev', () => { this.#offset = this.#previousOffsets.pop() ?? 0; this.#refreshResult(); });
    this.#click('user-task-next', () => { if (this.#page?.nextOffset !== undefined) { this.#previousOffsets.push(this.#offset); this.#offset = this.#page.nextOffset; this.#refreshResult(); } });
    this.#click('user-task-json', () => this.#export('json'));
    this.#click('user-task-csv', () => this.#export('csv'));
    this.#click('user-task-share', () => this.#share());
    this.#click('user-task-watchlist', () => {
      try {
        const symbols = this.#pageSymbols().map(symbol => {
          const routes = this.#routes(symbol); if (routes.length !== 1) throw new TaskError('task_chart_unavailable'); return routes[0].symbol;
        });
        if (!symbols.length) throw new TaskError('task_invalid_request'); this.#addWatchlist(symbols);
      } catch (error) { this.#error(error); }
    });
    this.#get('user-task-file').addEventListener('change', () => {
      const input = this.#get<HTMLInputElement>('user-task-file'), file = input.files?.[0]; input.value = '';
      if (!file) return;
      void this.#run('正在检查任务文件', async signal => {
        this.#preview = undefined; this.#definitionSignal = undefined;
        if (!/\.tft$/i.test(file.name)) throw new TaskError('task_file_type');
        if (file.size > TASK_LIMITS.sourceBytes) throw new TaskError('task_source_limit');
        const bytes = await file.arrayBuffer(); this.#check(signal);
        if (bytes.byteLength > TASK_LIMITS.sourceBytes) throw new TaskError('task_source_limit');
        let source: string; try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new TaskError('task_file_type'); }
        return this.#validate(source, signal);
      });
    });
  }
  #get<T extends HTMLElement = HTMLElement>(id: string): T { return this.#root.querySelector<T>(`#${id}`)!; }
  #click(id: string, handler: () => void) { this.#get(id).addEventListener('click', () => { if (!this.#closed) handler(); }); }
  #check(signal: AbortSignal) { if (this.#closed || signal.aborted) throw new TaskError('task_cancelled'); }
  #show(open: boolean) {
    if (this.#closed) return;
    this.#get('user-task-page').hidden = !open; this.#get('api-chat-page').hidden = open;
    this.#get('api-settings-page').hidden = true;
    const historyPage = this.#root.querySelector<HTMLElement>('#api-history-page'); if (historyPage) historyPage.hidden = true;
    this.#get(open ? 'user-task-import' : 'api-prompt').focus();
  }
  async initialize(): Promise<void> {
    if (this.#closed) return;
    this.#initializing ??= (async () => {
      this.#subscriptions.push(this.#host.manager().subscribe(() => this.#render()), this.#host.library().subscribe(() => this.#render()));
      try { await this.#host.library().initialize(); } catch (error) { if (!this.#closed) this.#status = taskUserError(error); }
      try { const sources = await this.#host.sources(); if (!this.#closed) this.#sources = sources; }
      catch (error) { if (!this.#closed) this.#status = taskUserError(error); }
      if (!this.#closed) { this.#fillSources(); this.#render(); }
    })();
    await this.#initializing;
  }
  async #run(label: string, operation: (signal: AbortSignal) => Promise<string>) {
    if (this.#closed || this.#busy) return;
    this.#busy = true; this.#status = t(label); const abort = new AbortController(); this.#abort = abort; this.#render();
    const signal = AbortSignal.any([abort.signal, this.#lifetime.signal]);
    try { const message = await operation(signal); this.#check(signal); this.#status = t(message); }
    catch (error) { if (!this.#closed) this.#status = taskUserError(error); }
    finally { this.#busy = false; this.#abort = undefined; this.#render(); }
  }
  #context(signal: AbortSignal): ToolExecutionContext {
    return { context: { scope: 'app', appInstanceId: this.#host.appInstanceId() }, signal, session: this.#owner, checkpoint: () => this.#check(signal) };
  }
  async #transaction<T extends ToolTransaction | AsyncToolTransaction>(prepare: () => Promise<T> | T, signal: AbortSignal): Promise<JsonValue> {
    let tx: T | undefined;
    try { tx = await prepare(); this.#check(signal); await tx.commit(); this.#check(signal); return tx.result; }
    catch (error) { try { await tx?.rollback(); } catch { throw new CapabilityError('rollback_failed'); } throw error; }
    finally { tx?.dispose?.(); }
  }
  async #validate(source: string, signal: AbortSignal): Promise<string> {
    this.#preview = undefined; this.#definitionSignal = undefined; await this.initialize(); this.#check(signal);
    const validated = await this.#host.manager().validate(source, signal); this.#check(signal); this.#setPreview(validated);
    return '文件已检查，选择数据后即可运行。';
  }
  #setPreview(preview: ValidatedTask, definitionSignal?: AbortSignal) {
    this.#preview = preview; this.#definitionSignal = definitionSignal;
    this.#get('user-task-name').textContent = preview.manifest.name; this.#get('user-task-description').textContent = preview.manifest.description;
    this.#get('user-task-windows').textContent = preview.manifest.history.map(h => `${h.resolution} · ${h.count} · ${h.adjustment}`).join('\n');
    this.#get<HTMLTextAreaElement>('user-task-source-code').value = preview.source;
    this.#buildParameters(); this.#fillSources(); this.#render();
  }
  #buildParameters() {
    const container = this.#get('user-task-parameters'); container.replaceChildren(); this.#parameterReaders.clear();
    if (!this.#preview || this.#preview.manifest.inputSchema.type !== 'object') return;
    const schema = this.#preview.manifest.inputSchema, defaults = this.#preview.manifest.defaults as Record<string, JsonValue>;
    for (const [key, field] of Object.entries(schema.properties)) {
      const label = element('label', key); label.className = 'user-task-field';
      let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const defaultValue = defaults[key], required = schema.required?.includes(key) ?? false; let dirty = false;
      if (field.type === 'boolean') {
        input = element('input'); input.type = 'checkbox'; input.checked = defaultValue === true;
      } else if (field.type === 'string' && field.enum) {
        input = element('select');
        if (!required && defaultValue === undefined) { const option = element('option', '—'); option.value = ''; input.append(option); }
        for (const value of field.enum) { const option = element('option', value); option.value = value; input.append(option); }
        input.value = typeof defaultValue === 'string' ? defaultValue : '';
      } else if (field.type === 'string' || field.type === 'number' || field.type === 'integer') {
        input = element('input'); input.type = field.type === 'string' ? 'text' : 'number';
        if (field.type === 'string') input.maxLength = field.maxLength ?? TASK_LIMITS.parametersBytes;
        else { input.step = field.type === 'integer' ? '1' : 'any'; if (field.minimum !== undefined) input.min = String(field.minimum); if (field.maximum !== undefined) input.max = String(field.maximum); }
        input.value = defaultValue === undefined ? '' : String(defaultValue);
      } else { input = element('textarea'); input.rows = 3; input.value = defaultValue === undefined ? '' : JSON.stringify(defaultValue, null, 2); }
      input.dataset.parameter = key; input.addEventListener('input', () => { dirty = true; }); input.addEventListener('change', () => { dirty = true; });
      this.#parameterReaders.set(key, () => {
        if (!required && defaultValue === undefined && !dirty && (field.type === 'boolean' || input.value === '')) return undefined;
        if (field.type === 'boolean') return (input as HTMLInputElement).checked;
        if (field.type === 'string') return input.value;
        if (field.type === 'number' || field.type === 'integer') { if (!input.value.trim()) throw new TaskError('task_invalid_parameters'); return Number(input.value); }
        try { return parseJson(input.value, TASK_LIMITS.parametersBytes).value; } catch { throw new TaskError('task_invalid_parameters'); }
      });
      label.append(input); container.append(label);
    }
  }
  #fillSources() {
    const select = this.#get<HTMLSelectElement>('user-task-source'), previous = select.value; select.replaceChildren();
    const compatible = this.#sources.filter(s => !this.#preview || this.#preview.manifest.history.every(h => s.resolutions.includes(h.resolution) && s.adjustments.includes(h.adjustment)));
    for (const source of compatible) { const option = element('option', source.name); option.value = source.providerId; select.append(option); }
    select.value = compatible.some(s => s.providerId === previous) ? previous : compatible[0]?.providerId ?? '';
    this.#fillVenues(); this.#fillCandidates();
  }
  #fillVenues() {
    const source = this.#sources.find(s => s.providerId === this.#get<HTMLSelectElement>('user-task-source').value);
    const select = this.#get<HTMLSelectElement>('user-task-venue'), previous = select.value; select.replaceChildren();
    if (source && source.catalogScope !== 'provider-catalog') { const option = element('option', t('全部市场')); option.value = ''; select.append(option); }
    for (const venue of source?.venues ?? []) { const option = element('option', venue); option.value = venue; select.append(option); }
    select.value = previous && source?.venues.includes(previous) ? previous : source?.catalogScope === 'provider-catalog' ? source.venues[0] ?? '' : '';
    const catalog = this.#get<HTMLSelectElement>('user-task-universe').querySelector<HTMLOptionElement>('option[value="catalog"]');
    if (catalog) catalog.textContent = t(source?.catalogScope === 'loaded-symbols' ? '已加载品种（不代表全市场）' : source?.local ? '已连接数据的品种' : '此市场的品种');
  }
  #fillCandidates() {
    const select = this.#get<HTMLSelectElement>('user-task-candidates'), previous = select.value; select.replaceChildren();
    const provider = this.#get<HTMLSelectElement>('user-task-source').value;
    const values: string[] = [];
    for (const run of this.#host.manager().list()) if (run.complete && run.providerId === provider) for (const artifact of run.artifacts) if (artifact.type === 'symbol_list') {
      const value = JSON.stringify({ taskId: run.taskId, artifactId: artifact.id }); values.push(value);
      const option = element('option', `${run.title} · ${artifact.title} · ${artifact.rows}`); option.value = value; select.append(option);
    }
    select.value = values.includes(previous) ? previous : values[0] ?? '';
    this.#get('user-task-candidates-field').hidden = this.#get<HTMLSelectElement>('user-task-universe').value !== 'result';
  }
  #start() {
    const preview = this.#preview; if (!preview) return;
    void this.#run('正在准备任务', async signal => {
      const parameters: Record<string, JsonValue> = Object.create(null);
      for (const [key, read] of this.#parameterReaders) { const value = read(); if (value !== undefined) parameters[key] = value; }
      const providerId = this.#get<HTMLSelectElement>('user-task-source').value, venue = this.#get<HTMLSelectElement>('user-task-venue').value;
      if (!providerId) throw new TaskError('task_source_unavailable');
      let universe: TaskStart['universe']; const mode = this.#get<HTMLSelectElement>('user-task-universe').value;
      if (mode === 'catalog') universe = { type: 'catalog' };
      else if (mode === 'watchlist') universe = { type: 'symbols', symbols: this.#host.watchlist().filter(s => s.providerId === providerId && (!venue || s.symbol.startsWith(`${venue}:`))) };
      else if (mode === 'result') {
        let value; try { value = JSON.parse(this.#get<HTMLSelectElement>('user-task-candidates').value); } catch { throw new TaskError('task_invalid_universe'); }
        universe = { type: 'result', taskId: value.taskId, artifactId: value.artifactId };
      } else throw new TaskError('task_invalid_request');
      const result = await this.#transaction(() => this.#host.manager().prepareStart(preview,
        { providerId, ...(venue ? { venue } : {}), universe, parameters: taskParameters(parameters, preview.manifest) }, this.#owner, signal, this.#definitionSignal), signal);
      this.#selectResult((result as { taskId: string }).taskId); return '任务已开始，可在下方查看进度。';
    });
  }
  #button(label: string, action: string, run: () => void): HTMLButtonElement {
    const button = element('button', t(label)); button.type = 'button'; button.dataset.action = action;
    button.addEventListener('click', () => { if (!this.#closed) run(); }); return button;
  }
  #render() {
    if (this.#closed) return;
    this.#get('user-task-page').dataset.busy = String(this.#busy); this.#get('user-task-status').textContent = this.#status;
    this.#get('user-task-abort').hidden = !this.#busy;
    for (const id of ['user-task-import','user-task-example','user-task-ai','user-task-refresh-sources','user-task-dismiss']) this.#get<HTMLButtonElement>(id).disabled = this.#busy;
    this.#get<HTMLButtonElement>('user-task-start').disabled = this.#busy || !this.#preview || !this.#get<HTMLSelectElement>('user-task-source').value;
    for (const input of this.#get('user-task-setup').querySelectorAll<HTMLInputElement>('input,select,textarea')) input.disabled = this.#busy;
    this.#get('user-task-setup').hidden = !this.#preview;
    const runs = this.#host.manager().list(), saved = this.#host.library().list();
    this.#get('user-task-empty').hidden = runs.length > 0;
    for (const [id, card] of this.#cards) if (!runs.some(r => r.taskId === id)) { card.element.remove(); this.#cards.delete(id); }
    for (const run of runs) {
      let card = this.#cards.get(run.taskId);
      if (!card) {
        const root = element('article'); root.className = 'user-task-card user-task-run'; root.dataset.taskId = run.taskId;
        const title = element('strong'), progress = element('progress'), detail = element('p'); detail.className = 'user-task-notice';
        const actions = element('div'); actions.className = 'user-task-actions';
        const view = this.#button('查看结果','view',()=>this.#selectResult(run.taskId));
        const stop = this.#button('停止','cancel',()=>{ try { this.#host.manager().cancel(run.taskId); } catch (e) { this.#error(e); } });
        const save = this.#button('保存为工具','save',()=>this.#save(run.taskId));
        const remove = this.#button('移除结果','release',()=>{ try { this.#host.manager().release(run.taskId); } catch (e) { this.#error(e); } });
        actions.append(view, stop, save, remove); root.append(title, progress, detail, actions); this.#get('user-task-runs').append(root);
        card = { element: root, title, progress, detail, stop, save }; this.#cards.set(run.taskId, card);
      }
      card.element.dataset.selected = String(run.taskId === this.#selected); card.title.textContent = run.title;
      card.detail.textContent = `${t(TASK_STATES[run.state] ?? run.state)} · ${run.processed}/${run.universeComplete ? run.discovered : `${run.discovered}+`}\n${run.sourceName}${run.currentSymbol ? ` · ${run.currentSymbol}` : ''}${run.errorCode ? `\n${taskUserError(new TaskError(run.errorCode))}` : ''}`;
      if (run.universeComplete) { card.progress.max = Math.max(1, run.discovered); card.progress.value = run.processed; } else card.progress.removeAttribute('value');
      card.stop.hidden = isFinal(run.state); card.stop.disabled = run.state === 'cancelling'; card.save.hidden = !run.complete; card.save.disabled = this.#busy;
      card.save.textContent = t(saved.some(s => s.id === this.#host.manager().manifest(run.taskId).id) ? '更新已保存任务' : '保存为工具');
    }
    const selected = runs.find(r => r.taskId === this.#selected); this.#get('user-task-result').hidden = !selected;
    if (selected) {
      this.#renderResultStatus(selected);
      if (this.#selectedState !== selected.state) { this.#selectedState = selected.state; this.#refreshResult(); }
    } else { this.#selected = undefined; this.#page = undefined; this.#get('user-task-result-body').replaceChildren(); }
    const revision = JSON.stringify(saved) + this.#host.library().corruptCount + this.#busy;
    if (revision !== this.#libraryRevision) { this.#libraryRevision = revision; this.#renderLibrary(saved); }
  }
  #renderResultStatus(run: RunStatus) {
    const scope = run.universeScope === 'loaded-symbols' ? t('已加载品种（不代表全市场）') : run.sourceName;
    this.#get('user-task-result-title').textContent = run.title;
    this.#get('user-task-result-state').textContent = `${t(TASK_STATES[run.state] ?? run.state)} · ${scope}\n${localized('已处理','Processed')} ${run.processed} · ${localized('短窗口','Short windows')} ${run.shortfallSymbols} · ${localized('空数据','Empty windows')} ${run.emptySymbols}`
      + (run.complete ? '' : `\n${t('任务尚未结束，当前显示的是已读取的部分结果。')}`)
      + (run.errorCode ? `\n${taskUserError(new TaskError(run.errorCode))}${run.failedSymbol ? ` · ${run.failedSymbol}` : ''}` : '');
  }
  #renderLibrary(rows: ReturnType<UserTaskLibrary['list']>) {
    const container = this.#get('user-task-library'); container.replaceChildren(); this.#get('user-task-library-empty').hidden = rows.length > 0;
    for (const row of rows) {
      const card = element('article'); card.className = 'user-task-card'; card.append(element('strong', row.name));
      const detail = element('p', row.errorCode ? taskUserError(new TaskError(row.errorCode)) : `v${row.version}`); detail.className = 'user-task-notice'; card.append(detail);
      const actions = element('div'); actions.className = 'user-task-actions';
      const run = this.#button('运行','run',()=>{ void this.#run('正在读取已保存任务',async signal=>{
        const entry = this.#host.library().get(row.id); this.#check(signal); this.#setPreview(entry.validated, entry.signal); return '文件已检查，选择数据后即可运行。';
      }); }); run.disabled = this.#busy || row.status !== 'ready';
      const remove = this.#button('删除工具','remove',()=>{ void this.#run('正在删除任务工具',async signal=>{
        await this.#transaction(()=>this.#host.library().prepareRemove(row.id,row.revision,this.#context(signal)),signal); return '任务工具已删除，原始数据未改变。';
      }); }); remove.disabled = this.#busy; actions.append(run, remove); card.append(actions); container.append(card);
    }
    if (this.#host.library().corruptCount) container.append(element('p', localized('部分任务登记无法读取，未覆盖原记录。','Some task records could not be read. Original records were not overwritten.')));
  }
  #save(id: string) {
    void this.#run('正在保存任务工具',async signal=>{
      const value = this.#host.manager().definition(id); await this.#host.library().initialize(); this.#check(signal);
      const existing = this.#host.library().list().find(r=>r.id===value.manifest.id);
      if (existing?.status === 'ready' && this.#host.library().get(existing.id).record.hash === value.hash) return '相同任务已经保存，未重复更新。';
      await this.#transaction(()=>this.#host.library().prepareSave(value,existing?.revision??null,this.#context(signal)),signal); return '任务工具已保存。';
    });
  }
  #selectResult(id: string) {
    try {
      const status = this.#host.manager().status(id); this.#selected = id; this.#selectedState = status.state; this.#offset = 0; this.#previousOffsets = [];
      const select = this.#get<HTMLSelectElement>('user-task-artifact'); select.replaceChildren();
      for (const artifact of status.artifacts) { const option = element('option', artifact.title); option.value = artifact.id; select.append(option); }
      select.value = status.artifacts[0]?.id ?? ''; this.#get<HTMLInputElement>('user-task-filter').value = ''; this.#fillSort(); this.#refreshResult(); this.#render();
    } catch (error) { this.#error(error); }
  }
  #fillSort() {
    const select = this.#get<HTMLSelectElement>('user-task-sort'); select.replaceChildren(); const original = element('option',t('原始顺序')); original.value = ''; select.append(original); select.value = '';
    const artifact = this.#selected && this.#host.manager().status(this.#selected).artifacts.find(a=>a.id===this.#get<HTMLSelectElement>('user-task-artifact').value);
    if (artifact) for (const column of artifact.columns??[]) { const option = element('option',column.title); option.value = column.id; select.append(option); }
  }
  #refreshResult() {
    if (!this.#selected || this.#closed) return;
    try {
      const artifactId = this.#get<HTMLSelectElement>('user-task-artifact').value;
      const artifact = this.#host.manager().status(this.#selected).artifacts.find(a=>a.id===artifactId); if (!artifact) return;
      const table = artifact.type === 'table'; this.#get('user-task-table-controls').hidden = !table;
      const sort = this.#get<HTMLSelectElement>('user-task-sort').value, filter = this.#get<HTMLInputElement>('user-task-filter').value;
      this.#page = this.#host.manager().page(this.#selected,artifactId,{offset:this.#offset,limit:artifact.type==='report'?12000:50,
        ...(table&&sort?{sortBy:sort,descending:this.#get<HTMLInputElement>('user-task-descending').checked}:{}),...(table&&filter?{filter}:{})});
      renderTaskResult(this.#get('user-task-result-body'),this.#page,{routes:s=>this.#routes(s),open:s=>this.#open(s),watchlist:s=>this.#addWatchlist([s])});
      this.#get<HTMLButtonElement>('user-task-prev').disabled = !this.#previousOffsets.length;
      this.#get<HTMLButtonElement>('user-task-next').disabled = this.#page.nextOffset === undefined;
      this.#get<HTMLButtonElement>('user-task-csv').disabled = artifact.type==='report';
      this.#get('user-task-watchlist').hidden = !this.#pageSymbols().length;
      const length = artifact.type==='report' ? this.#page.text?.length??0 : this.#page.rows.length;
      this.#get('user-task-page-info').textContent = `${this.#offset+(length?1:0)}–${this.#offset+length} / ${this.#page.matched}`;
    } catch(error) { this.#error(error); }
  }
  #pageSymbols(): TaskSymbol[] {
    if (!this.#page) return []; const found = new Map<string,TaskSymbol>();
    for (const row of this.#page.rows) for (const cell of Array.isArray(row)?row:[row]) if(object(cell)&&typeof cell.symbol==='string') {
      const symbol = taskSymbol(cell); found.set(`${symbol.providerId}|${symbol.symbol}`,symbol);
    }
    return [...found.values()];
  }
  #routes(symbol: TaskSymbol): readonly TaskSymbolRoute[] {
    const local = this.#sources.find(s=>s.providerId===symbol.providerId)?.local ?? false;
    return this.#sources.filter(s=>!s.local && (local || s.providerId===symbol.providerId) && s.venues.includes(symbol.symbol.split(':')[0]) && s.kinds.includes(symbol.kind))
      .map(source=>({symbol:{...symbol,providerId:source.providerId},name:source.name}));
  }
  #open(symbol: TaskSymbol) {
    void this.#run('正在打开图表',async signal=>{ await this.#transaction(()=>this.#host.prepareOpen(symbol,this.#context(signal)),signal); return '已打开对应行情。'; });
  }
  #addWatchlist(symbols: readonly TaskSymbol[]) {
    void this.#run('正在加入自选',async signal=>{ await this.#transaction(()=>this.#host.prepareWatchlist(symbols,this.#context(signal)),signal); return '已加入自选。'; });
  }
  #export(format:'json'|'csv') {
    if (!this.#selected || !this.#page) return;
    try {
      const content = this.#host.manager().export(this.#selected,this.#page.artifactId,format);
      const filename = `task-${this.#selected}-${this.#page.artifactId}.${format}`, mime = format==='json'?'application/json;charset=utf-8':'text/csv;charset=utf-8';
      if (this.#host.download) this.#host.download(filename,content,mime);
      else {
        const url = URL.createObjectURL(new Blob([content],{type:mime})), anchor = element('a'); anchor.href=url; anchor.download=filename;
        document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    } catch(error) { this.#error(error); }
  }
  #draft(message:string) { try { this.#host.compose(message); this.#show(false); } catch(error) { this.#error(error); } }
  #share() {
    if (!this.#selected) return; let token:string|undefined;
    try {
      token = this.#host.manager().createShare(this.#selected);
      this.#host.compose(localized(`请使用 tf.task.claim，token 为 ${token}，读取我明确分享的任务结果。先检查是否完成及数据覆盖，再按需要分页读取并解释；不要把未完成或短窗口结果当作完整扫描，不要自动运行其他任务。`,
        `Use tf.task.claim with token ${token} to read the task result I explicitly shared. Check completion and coverage, then read only needed pages and explain the results. Do not present incomplete/short-window output as a full scan or run other jobs automatically.`));
      this.#show(false);
    } catch(error) { if(token)this.#host.manager().revokeShare(token); this.#error(error); }
  }
  #error(error:unknown) { if (!this.#closed) { this.#status=taskUserError(error); this.#get('user-task-status').textContent=this.#status; } }
  close() { if(this.#closed)return;this.#closed=true;this.#abort?.abort();this.#lifetime.abort();for(const unsubscribe of this.#subscriptions)unsubscribe();this.#subscriptions=[];this.#cards.clear();this.#parameterReaders.clear(); }
}

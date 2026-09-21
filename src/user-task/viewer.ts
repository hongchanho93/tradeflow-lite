import type { JsonValue } from '../ai-capabilities/contracts.ts';
import type { ResultPage } from './results.ts';
import { object, taskSymbol, type TaskSymbol } from './contracts.ts';
import { taskText } from './strings.ts';

export interface TaskSymbolRoute { symbol: TaskSymbol; name: string }
export interface TaskViewerActions {
  routes(symbol: TaskSymbol): readonly TaskSymbolRoute[];
  open(symbol: TaskSymbol): void;
  watchlist(symbol: TaskSymbol): void;
}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, value = '') => {
  const element = document.createElement(tag); element.textContent = value; return element;
};
function symbolCell(symbol: TaskSymbol, actions: TaskViewerActions): HTMLElement {
  const cell = node('div'); cell.className = 'user-task-symbol';
  cell.append(node('span', symbol.name === symbol.symbol ? symbol.symbol : `${symbol.name} · ${symbol.symbol}`));
  const links = node('div'); links.className = 'user-task-actions';
  for (const route of actions.routes(symbol)) {
    const open = node('button', `${document.documentElement.lang === 'en-US' ? 'Chart' : '图表'} · ${route.name}`); open.type = 'button'; open.dataset.action = 'open-symbol';
    open.addEventListener('click', () => actions.open(route.symbol));
    const add = node('button', `${document.documentElement.lang === 'en-US' ? 'Watchlist' : '自选'} · ${route.name}`); add.type = 'button'; add.dataset.action = 'add-symbol';
    add.addEventListener('click', () => actions.watchlist(route.symbol)); links.append(open, add);
  }
  cell.append(links); return cell;
}
function valueCell(value: JsonValue, actions: TaskViewerActions): HTMLElement {
  if (object(value) && typeof value.symbol === 'string') return symbolCell(taskSymbol(value), actions);
  const text = value === null ? '—' : typeof value === 'number' ? String(value) : typeof value === 'boolean' ? (document.documentElement.lang === 'en-US' ? String(value) : value ? '是' : '否') : String(value);
  if (text.length <= 1200) return node('span', text);
  const details = node('details'), summary = node('summary', `${text.slice(0, 160)}… ${taskText('显示完整内容')}`);
  let expanded = false; details.append(summary);
  details.addEventListener('toggle', () => { if (details.open && !expanded) { expanded = true; details.append(node('pre', text)); } }); return details;
}
/** Fixed host renderer, not guest HTML/Markdown/JS. Only the current bounded page is rendered. */
export function renderTaskResult(container: HTMLElement, page: ResultPage, actions: TaskViewerActions): void {
  container.replaceChildren();
  if (page.type === 'report') { container.append(node('pre', page.text ?? '')); return; }
  if (!page.rows.length) { container.append(node('p', taskText('暂无可显示的行。'))); return; }
  if (page.type === 'series') {
    const points = page.rows as readonly { readonly time: number; readonly value: number }[];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 600 180');
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', taskText('本页序列')); svg.classList.add('user-task-series');
    const values = points.map(p => p.value), scale = Math.max(1, ...values.map(Math.abs));
    const normalized = values.map(v => v / scale), low = Math.min(...normalized), high = Math.max(...normalized);
    const first = points[0].time, last = points.at(-1)!.time;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', points.map((p, i) => `${last === first ? 300 : 20 + (p.time - first) / (last - first) * 560},${high === low ? 85 : 150 - (normalized[i] - low) / (high - low) * 130}`).join(' '));
    line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '2'); svg.append(line);
    if (points.length === 1) { const point = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); point.setAttribute('cx', '300'); point.setAttribute('cy', '85'); point.setAttribute('r', '3'); point.setAttribute('fill', 'currentColor'); svg.append(point); }
    container.append(svg);
    const label = node('p', `${first} → ${last} · ${taskText('只显示当前页；完整内容可导出。')}`); label.className = 'user-task-notice'; container.append(label);
  }
  const table = node('table'); table.className = 'user-task-table'; const head = node('thead'), row = node('tr');
  const titles = page.type === 'table' ? page.columns!.map(c => c.title) : page.type === 'series' ? (document.documentElement.lang === 'en-US' ? ['Time (Unix seconds)','Value'] : ['时间（Unix 秒）','数值']) : [document.documentElement.lang === 'en-US' ? 'Symbol' : '品种'];
  for (const title of titles) row.append(node('th', title)); head.append(row); table.append(head); const body = node('tbody');
  for (const item of page.rows) {
    const tr = node('tr');
    const cells = page.type === 'table' ? item as readonly JsonValue[] : page.type === 'series' ? [(item as Record<string, JsonValue>).time, (item as Record<string, JsonValue>).value] : [item];
    for (const value of cells) { const td = node('td'); td.append(valueCell(value, actions)); tr.append(td); } body.append(tr);
  }
  table.append(body); container.append(table);
}

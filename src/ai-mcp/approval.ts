import type { JsonValue } from '../ai-capabilities/contracts.ts';
import type { McpApproval } from './session.ts';

const record = (value: JsonValue | undefined): { readonly [key: string]: JsonValue } | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as { readonly [key: string]: JsonValue } : undefined;

/** Describe the host-normalized plan, never the model's narrative. This display
 * does not authorize anything or change the frozen request. All output is text. */
export function approvalOverview(approval: McpApproval, english = false): readonly string[] {
  if (approval.toolId === 'tf.drawings.revert' || approval.toolId === 'tf.drawings.revert_saved') {
    return [english
      ? 'Undo this drawing batch only. Restore modified or deleted objects and remove objects created by the batch. Conflicting edits will be rejected.'
      : '只撤销这一批绘图：移除该批新增对象，恢复该批修改或删除的对象。不会清空整张图；存在后续编辑冲突时将拒绝执行。'];
  }
  const operations = record(approval.proposal)?.operations;
  if (!Array.isArray(operations)) return [english ? 'Review the complete operation below before confirming.' : '请展开完整操作，核对后再确认。'];
  const names: Record<string, string> = english ? {}
    : { HorizontalLine: '水平线', TrendLine: '趋势线', Rectangle: '矩形', Text: '文字' };
  const verbs: Record<string, string> = english ? { create: 'Create', update: 'Update', delete: 'Delete' }
    : { create: '新建', update: '修改', delete: '删除' };
  return operations.slice(0, 32).map(value => {
    const operation = record(value);
    if (!operation) return english ? 'Review operation details' : '请核对完整操作';
    const before = record(operation.before); const after = record(operation.after);
    const drawing = after ?? before; const type = drawing?.type;
    const describe = (spec: ReturnType<typeof record>) => {
      if (!spec) return '';
      const points = Array.isArray(spec.points) ? spec.points.slice(0, 16).map(value => {
        const point = record(value);
        if (typeof point?.price !== 'number' || typeof point.time !== 'number') return '';
        const date = new Date(point.time * 1000);
        const time = Number.isFinite(date.getTime()) ? date.toISOString().replace('.000Z', 'Z') : `UNIX ${point.time}`;
        return `${point.price} @ ${time}`;
      }).filter(Boolean).join(' → ') : '';
      const style = record(spec.style);
      const text = typeof style?.text === 'string' ? ` · ${JSON.stringify(style.text)}` : '';
      const color = typeof style?.color === 'string' ? ` · ${style.color}` : '';
      const hidden = style?.visible === false ? (english ? ' · hidden' : ' · 隐藏') : '';
      return points + text + color + hidden;
    };
    const verb = typeof operation.op === 'string' ? verbs[operation.op] ?? operation.op : '';
    const label = typeof type === 'string' ? names[type] ?? type : (english ? 'drawing' : '绘图');
    const details = operation.op === 'update' ? `${describe(before)} ⇒ ${describe(after)}` : describe(drawing);
    return `${verb} ${label}\n${details}`;
  });
}

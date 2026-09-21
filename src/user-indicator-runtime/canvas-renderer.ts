import type { IndicatorCanvasFrame } from '../indicator-sdk/contracts.ts';
import type {
  UserIndicatorCanvasCommand,
  UserIndicatorCanvasDash,
  UserIndicatorCanvasPoint,
} from './output-protocol.ts';

type ResolvedPoint = Readonly<{ x: number; y: number }>;
export type UserIndicatorCanvasHitRegion = Readonly<{
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

const DASH_PATTERNS: Readonly<Record<UserIndicatorCanvasDash, readonly number[]>> = Object.freeze({
  solid: Object.freeze([]),
  dashed: Object.freeze([6, 4]),
  dotted: Object.freeze([2, 3]),
});

function resolvePoint(
  frame: IndicatorCanvasFrame,
  point: UserIndicatorCanvasPoint,
): ResolvedPoint | null {
  if (point.space === 'pane-pixel') return { x: point.x, y: point.y };
  const x = frame.coordinates.timeToX(point.time);
  if (x === null) return null;
  if (point.space === 'time-pixel') return { x, y: point.y };
  const y = frame.coordinates.priceToY?.(point.price) ?? null;
  return y === null ? null : { x, y };
}

function resolvePoints(
  frame: IndicatorCanvasFrame,
  points: readonly UserIndicatorCanvasPoint[],
): readonly ResolvedPoint[] | null {
  const resolved: ResolvedPoint[] = [];
  for (const point of points) {
    const next = resolvePoint(frame, point);
    if (!next) return null;
    resolved.push(next);
  }
  return resolved;
}

function applyStroke(
  context: CanvasRenderingContext2D,
  color: string,
  lineWidth: number | undefined,
  dash: UserIndicatorCanvasDash | undefined,
): void {
  context.strokeStyle = color;
  context.lineWidth = lineWidth ?? 1;
  context.setLineDash([...DASH_PATTERNS[dash ?? 'solid']]);
}

function applyOptionalStroke(
  context: CanvasRenderingContext2D,
  color: string | undefined,
  lineWidth: number | undefined,
  dash: UserIndicatorCanvasDash | undefined,
): void {
  if (color === undefined) return;
  applyStroke(context, color, lineWidth, dash);
  context.stroke();
}

function hitRegionForCommand(
  frame: IndicatorCanvasFrame,
  command: UserIndicatorCanvasCommand,
): UserIndicatorCanvasHitRegion | null {
  if (command.hitTest !== true || !command.id) return null;
  let points: readonly ResolvedPoint[] | null;
  if (command.type === 'line' || command.type === 'rect') points = resolvePoints(frame, [command.from, command.to]);
  else if (command.type === 'polyline' || command.type === 'polygon') points = resolvePoints(frame, command.points);
  else if (command.type === 'circle' || command.type === 'text') {
    const at = resolvePoint(frame, command.at);
    if (!at) return null;
    const radius = command.type === 'circle' ? command.radius : command.fontSize;
    return Object.freeze({
      id: command.id,
      left: at.x - radius,
      top: at.y - radius,
      right: at.x + radius,
      bottom: at.y + radius,
    });
  } else return null;
  if (!points || points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const tolerance = 6;
  return Object.freeze({
    id: command.id,
    left: Math.min(...xs) - tolerance,
    top: Math.min(...ys) - tolerance,
    right: Math.max(...xs) + tolerance,
    bottom: Math.max(...ys) + tolerance,
  });
}

function drawCommand(frame: IndicatorCanvasFrame, command: UserIndicatorCanvasCommand): void {
  const context = frame.context;

  if (command.type === 'line') {
    const points = resolvePoints(frame, [command.from, command.to]);
    if (!points) return;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    context.lineTo(points[1].x, points[1].y);
    applyStroke(context, command.color, command.lineWidth, command.dash);
    context.stroke();
    return;
  }

  if (command.type === 'polyline' || command.type === 'polygon') {
    const points = resolvePoints(frame, command.points);
    if (!points || points.length === 0) return;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
    if (command.type === 'polyline') {
      applyStroke(context, command.color, command.lineWidth, command.dash);
      context.stroke();
      return;
    }
    context.closePath();
    if (command.fillColor !== undefined) {
      context.fillStyle = command.fillColor;
      context.fill();
    }
    applyOptionalStroke(context, command.borderColor, command.lineWidth, command.dash);
    return;
  }

  if (command.type === 'rect') {
    const points = resolvePoints(frame, [command.from, command.to]);
    if (!points) return;
    const x = Math.min(points[0].x, points[1].x);
    const y = Math.min(points[0].y, points[1].y);
    const width = Math.abs(points[1].x - points[0].x);
    const height = Math.abs(points[1].y - points[0].y);
    context.beginPath();
    context.rect(x, y, width, height);
    if (command.fillColor !== undefined) {
      context.fillStyle = command.fillColor;
      context.fill();
    }
    applyOptionalStroke(context, command.borderColor, command.lineWidth, command.dash);
    return;
  }

  if (command.type === 'circle') {
    const at = resolvePoint(frame, command.at);
    if (!at) return;
    context.beginPath();
    context.arc(at.x, at.y, command.radius, 0, Math.PI * 2);
    if (command.fillColor !== undefined) {
      context.fillStyle = command.fillColor;
      context.fill();
    }
    applyOptionalStroke(context, command.borderColor, command.lineWidth, command.dash);
    return;
  }

  const at = resolvePoint(frame, command.at);
  if (!at) return;
  context.fillStyle = command.color;
  context.font = `${command.fontSize}px sans-serif`;
  context.textAlign = command.align ?? 'center';
  context.textBaseline = 'middle';
  context.setLineDash([]);
  context.fillText(command.text, at.x, at.y);
}

export function drawUserIndicatorCanvasCommands(
  frame: IndicatorCanvasFrame,
  commands: readonly UserIndicatorCanvasCommand[],
): readonly UserIndicatorCanvasHitRegion[] {
  const context = frame.context;
  const hitRegions: UserIndicatorCanvasHitRegion[] = [];
  context.save();
  try {
    context.beginPath();
    context.rect(0, 0, frame.width, frame.height);
    context.clip();
    for (const command of commands) {
      drawCommand(frame, command);
      const region = hitRegionForCommand(frame, command);
      if (region) hitRegions.push(region);
    }
  } finally {
    context.restore();
  }
  return Object.freeze(hitRegions);
}

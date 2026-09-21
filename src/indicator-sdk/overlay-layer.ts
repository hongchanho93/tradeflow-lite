import type { IChartApi, IPaneApi, Time } from 'lightweight-charts';
import type {
  IndicatorOverlayDefinition,
  IndicatorOverlayHandle,
} from './contracts';

export class ManagedOverlay implements IndicatorOverlayHandle {
  readonly key: string;
  readonly instanceId: string;

  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private style: HTMLStyleElement;
  private contentRoot: HTMLElement;
  private definition: IndicatorOverlayDefinition;
  private visible = true;

  constructor(container: HTMLElement, instanceId: string, definition: IndicatorOverlayDefinition) {
    this.key = definition.key;
    this.instanceId = instanceId;
    this.definition = definition;
    this.host = document.createElement('div');
    this.host.dataset.indicatorOverlay = definition.key;
    this.host.style.cssText = 'position:absolute;z-index:4;pointer-events:none;max-width:100%;max-height:100%;';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.style = document.createElement('style');
    this.contentRoot = document.createElement('div');
    this.contentRoot.setAttribute('part', 'content');
    this.shadow.append(this.style, this.contentRoot);
    container.append(this.host);
    this.setDefinition(definition);
  }

  setDefinition(definition: IndicatorOverlayDefinition): void {
    this.definition = definition;
    this.host.style.pointerEvents = definition.interactive ? 'auto' : 'none';
  }

  paneKey(): string {
    return this.definition.paneKey;
  }

  position(): IndicatorOverlayDefinition['position'] {
    return this.definition.position;
  }

  setStyles(cssText: string): void {
    this.style.textContent = cssText;
  }

  get root(): HTMLElement {
    return this.contentRoot;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.host.hidden = !visible;
  }

  clear(): void {
    this.contentRoot.replaceChildren();
    this.style.textContent = '';
  }

  renewContent(): void {
    this.style = document.createElement('style');
    this.contentRoot = document.createElement('div');
    this.contentRoot.setAttribute('part', 'content');
    this.shadow.replaceChildren(this.style, this.contentRoot);
  }

  layout(rect: Readonly<{ left: number; top: number; width: number; height: number }>): void {
    if (!this.visible) return;
    const vertical = this.definition.position.startsWith('top')
      ? 'top'
      : this.definition.position.startsWith('bottom')
        ? 'bottom'
        : 'middle';
    const top = vertical === 'top'
      ? rect.top + 8
      : vertical === 'bottom'
        ? rect.top + rect.height - 8
        : rect.top + rect.height / 2;
    const left = this.definition.position.endsWith('left') ? rect.left + 8 : rect.left + rect.width - 8;
    const translateX = this.definition.position.endsWith('left') ? '0' : '-100%';
    const translateY = vertical === 'top' ? '0' : vertical === 'bottom' ? '-100%' : '-50%';
    this.host.style.left = `${Math.round(left)}px`;
    this.host.style.top = `${Math.round(top)}px`;
    this.host.style.transform = `translate(${translateX}, ${translateY})`;
    this.host.style.maxWidth = `${Math.max(0, Math.floor(rect.width - 16))}px`;
    this.host.style.maxHeight = `${Math.max(0, Math.floor(rect.height - 16))}px`;
  }

  remove(): void {
    this.host.remove();
  }
}

export class OverlayLayoutManager {
  readonly host: HTMLDivElement;

  private readonly overlays = new Set<ManagedOverlay>();
  private readonly chart: IChartApi;
  private readonly container: HTMLElement;
  private readonly paneForKey: (instanceId: string, paneKey: string) => IPaneApi<Time> | null;
  private frameId: number | undefined;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    chart: IChartApi,
    container: HTMLElement,
    paneForKey: (instanceId: string, paneKey: string) => IPaneApi<Time> | null,
  ) {
    this.chart = chart;
    this.container = container;
    this.paneForKey = paneForKey;
    this.host = document.createElement('div');
    this.host.className = 'indicator-overlay-host';
    this.host.style.cssText = 'position:absolute;inset:0;z-index:4;overflow:hidden;pointer-events:none;';
    container.append(this.host);
    this.resizeObserver = new ResizeObserver(() => this.requestLayout());
    this.resizeObserver.observe(container);
    chart.timeScale().subscribeSizeChange(this.requestLayout);
    container.addEventListener('pointermove', this.requestLayout, { passive: true });
    container.addEventListener('pointerup', this.requestLayout, { passive: true });
  }

  create(instanceId: string, definition: IndicatorOverlayDefinition): ManagedOverlay {
    const overlay = new ManagedOverlay(this.host, instanceId, definition);
    this.overlays.add(overlay);
    this.requestLayout();
    return overlay;
  }

  remove(overlay: ManagedOverlay): void {
    this.overlays.delete(overlay);
    overlay.remove();
  }

  readonly requestLayout = (): void => {
    if (this.frameId !== undefined) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = undefined;
      this.layout();
    });
  };

  dispose(): void {
    this.resizeObserver.disconnect();
    this.chart.timeScale().unsubscribeSizeChange(this.requestLayout);
    this.container.removeEventListener('pointermove', this.requestLayout);
    this.container.removeEventListener('pointerup', this.requestLayout);
    if (this.frameId !== undefined) cancelAnimationFrame(this.frameId);
    this.frameId = undefined;
    for (const overlay of this.overlays) overlay.remove();
    this.overlays.clear();
    this.host.remove();
  }

  private layout(): void {
    const panes = this.chart.panes();
    const paneHeights = panes.map((pane) => pane.getHeight());
    const contentHeight = Math.max(0, this.container.clientHeight - this.chart.timeScale().height());
    const totalGap = Math.max(0, contentHeight - paneHeights.reduce((sum, height) => sum + height, 0));
    const gap = panes.length > 1 ? totalGap / (panes.length - 1) : 0;
    const left = this.chart.priceScale('left').width();
    const width = this.chart.timeScale().width();
    for (const overlay of this.overlays) {
      const pane = overlay.paneKey() === 'main' ? panes[0] : this.paneForKey(overlay.instanceId, overlay.paneKey());
      if (!pane) continue;
      const paneIndex = panes.indexOf(pane);
      if (paneIndex < 0) continue;
      const top = paneHeights.slice(0, paneIndex).reduce((sum, height) => sum + height, 0) + gap * paneIndex;
      overlay.layout({ left, top, width, height: paneHeights[paneIndex] });
    }
  }
}

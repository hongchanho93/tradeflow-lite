import { CapabilityCore, type CapabilitySession } from './core.ts';
import { CapabilityRegistry } from './registry.ts';
import { type Permission, type SelectionRef, type ToolDefinition } from './contracts.ts';
import { ChartSnapshotStore, type ChartReadState } from './chart-data.ts';
import { createChartReadTools } from './chart-tools.ts';
import type { MarketResultStore } from './market-data.ts';
import type { DrawingDocumentPort } from './drawing-contract.ts';
import { DrawingChangeManager } from './drawing-changes.ts';
import { createDrawingTools, createDrawingRecoveryTools } from './drawing-tools.ts';

/** In-process host port. No IPC/global registration, accounts or automatic session. */
export class ChartReadBridge {
  readonly #currentContext: () => SelectionRef;
  readonly #core: CapabilityCore;
  readonly #registry: CapabilityRegistry;

  constructor(host: { currentContext(): SelectionRef; readState(): ChartReadState; drawings?: DrawingDocumentPort;
    tools?: readonly ToolDefinition[]; marketResults?: MarketResultStore }) {
    this.#currentContext = () => host.currentContext();
    const reads = createChartReadTools(new ChartSnapshotStore(() => host.readState()), host.marketResults);
    const drawings = host.drawings ? new DrawingChangeManager(host.drawings, this.#currentContext) : undefined;
    this.#registry = new CapabilityRegistry([...reads, ...(host.tools ?? []), ...(drawings
      ? [...createDrawingTools(drawings), ...createDrawingRecoveryTools(drawings)] : [])]);
    this.#core = new CapabilityCore(this.#registry);
  }

  /** Only trusted UI/authenticated transport may grant permissions. */
  openSession(permissions: Readonly<Record<string, Permission>>): CapabilitySession {
    return this.#core.openSession({
      context: this.#currentContext(), currentContext: this.#currentContext, permissions,
    });
  }

  describe() { return this.#registry.describe(); }
  createOwner(id: string) { return this.#registry.createOwner(id); }
  subscribeTools(listener: () => void): () => void { return this.#registry.subscribe(listener); }
  invalidateChart(): void { this.#core.invalidateCharts(); }
  close(): void { this.#core.closeSessions(); }
}

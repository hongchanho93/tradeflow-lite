import type { IndicatorChartHost } from '../indicator-sdk/chart-host.ts';
import type { IndicatorMainSeriesHost } from '../indicator-sdk/main-series-host.ts';
import type { UserIndicatorDataEvent } from './data-protocol.ts';
import type { UserIndicatorPointerEvent } from './supervisor-protocol.ts';
import { createUserIndicatorExecutionWorker } from './execution-worker-factory.ts';
import {
  UserIndicatorOutputAdapter,
  type UserIndicatorPointerHit,
  type UserIndicatorChartHostLike,
  type UserIndicatorMainSeriesHostLike,
} from './output-adapter.ts';
import {
  UserIndicatorSupervisor,
  type UserIndicatorSupervisorFailure,
  type UserIndicatorWorkerFactory,
} from './supervisor.ts';

export type UserIndicatorRuntimeControllerOptions = Readonly<{
  workerFactory?: UserIndicatorWorkerFactory;
  mainSeriesHost?: IndicatorMainSeriesHost | UserIndicatorMainSeriesHostLike;
  onFailure?: (failure: UserIndicatorSupervisorFailure) => void;
}>;

/**
 * C4 host-side coordinator for an already validated .tfi source.
 * Import/library validation remains a separate P3-1E concern.
 */
export class UserIndicatorRuntimeController {
  private readonly adapter: UserIndicatorOutputAdapter;
  private readonly supervisor: UserIndicatorSupervisor;
  private readonly visibility = new Map<string, boolean>();

  constructor(
    chartHost: IndicatorChartHost | UserIndicatorChartHostLike,
    options: UserIndicatorRuntimeControllerOptions = {},
  ) {
    this.adapter = new UserIndicatorOutputAdapter(chartHost, options.mainSeriesHost ?? null);
    this.supervisor = new UserIndicatorSupervisor({
      workerFactory: options.workerFactory ?? createUserIndicatorExecutionWorker,
      onOutput: (response, event) => {
        this.adapter.apply(response, event);
        const visible = this.visibility.get(response.instanceId);
        if (visible !== undefined) this.adapter.setVisible(response.instanceId, visible);
      },
      onFailure: (failure) => {
        if (this.adapter.has(failure.instanceId)) this.adapter.remove(failure.instanceId);
        options.onFailure?.(failure);
      },
    });
  }

  create(
    instanceId: string,
    source: string,
    inputs: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
    initialEvent: UserIndicatorDataEvent,
  ): void {
    this.supervisor.create(instanceId, source, inputs, context, initialEvent);
  }

  rebuild(
    instanceId: string,
    source: string,
    inputs: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
    initialEvent: UserIndicatorDataEvent,
  ): void {
    this.supervisor.rebuild(instanceId, source, inputs, context, initialEvent);
  }

  update(instanceId: string, event: UserIndicatorDataEvent): void {
    this.supervisor.update(instanceId, event);
  }

  pointer(instanceId: string, event: UserIndicatorPointerEvent): void {
    this.supervisor.pointer(instanceId, event);
  }

  hitTest(time: number | null, x: number, y: number): UserIndicatorPointerHit | null {
    return this.adapter.hitTest(time, x, y);
  }

  retry(instanceId: string, event: UserIndicatorDataEvent): void {
    this.supervisor.retry(instanceId, event);
  }

  remove(instanceId: string): void {
    this.supervisor.remove(instanceId);
    if (this.adapter.has(instanceId)) this.adapter.remove(instanceId);
    this.visibility.delete(instanceId);
  }

  setVisible(instanceId: string, visible: boolean): void {
    this.visibility.set(instanceId, visible);
    this.adapter.setVisible(instanceId, visible);
  }

  destroy(): void {
    this.supervisor.destroy();
    this.adapter.destroy();
    this.visibility.clear();
  }

  list(): ReturnType<UserIndicatorSupervisor['list']> {
    return this.supervisor.list();
  }
}

import type { Disposable, IndicatorResourceApi } from './contracts';

type TimerHost = Pick<typeof globalThis, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'> & Partial<
  Pick<typeof globalThis, 'requestAnimationFrame' | 'cancelAnimationFrame'>
>;

export class IndicatorExecutionScope {
  private cleanups: Array<() => void> = [];
  private disposed = false;
  private readonly timers: TimerHost;
  private readonly onError: (error: unknown) => void;
  private readonly onCallbackError: (error: unknown) => void;

  constructor(
    timers: TimerHost = globalThis,
    onError: (error: unknown) => void = () => {},
    onCallbackError: (error: unknown) => void = onError,
  ) {
    this.timers = timers;
    this.onError = onError;
    this.onCallbackError = onCallbackError;
  }

  add(cleanup: () => void): Disposable {
    if (this.disposed) {
      cleanup();
      return { dispose() {} };
    }
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      cleanup();
    };
    this.cleanups.push(dispose);
    return { dispose };
  }

  use<T extends Disposable>(resource: T): T {
    this.add(() => resource.dispose());
    return resource;
  }

  api(): IndicatorResourceApi {
    return Object.freeze({
      add: (cleanup: () => void) => this.add(cleanup),
      setTimeout: (callback: () => void, delayMs: number) => {
        let disposable: Disposable;
        const timer = this.timers.setTimeout(() => {
          disposable.dispose();
          if (this.disposed) return;
          try {
            callback();
          } catch (error) {
            this.onCallbackError(error);
          }
        }, delayMs);
        disposable = this.add(() => this.timers.clearTimeout(timer));
        return disposable;
      },
      setInterval: (callback: () => void, delayMs: number) => {
        const timer = this.timers.setInterval(() => {
          if (this.disposed) return;
          try {
            callback();
          } catch (error) {
            this.onCallbackError(error);
          }
        }, delayMs);
        return this.add(() => this.timers.clearInterval(timer));
      },
      requestAnimationFrame: (callback: (time: number) => void) => {
        if (this.timers.requestAnimationFrame && this.timers.cancelAnimationFrame) {
          let disposable: Disposable;
          const frame = this.timers.requestAnimationFrame((time) => {
            disposable.dispose();
            if (this.disposed) return;
            try {
              callback(time);
            } catch (error) {
              this.onCallbackError(error);
            }
          });
          disposable = this.add(() => this.timers.cancelAnimationFrame!(frame));
          return disposable;
        }
        return this.api().setTimeout(() => callback(Date.now()), 16);
      },
    });
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of this.cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        this.onError(error);
      }
    }
    this.cleanups = [];
  }
}

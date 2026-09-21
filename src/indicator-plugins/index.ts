import type { IndicatorDefinition } from '../indicator-sdk/contracts';
import type { IndicatorRegistry } from '../indicator-sdk/registry';

type IndicatorModule = { default: IndicatorDefinition };

const userModules = import.meta.glob<IndicatorModule>('./user/*.indicator.ts');
const contributedModules = import.meta.glob<IndicatorModule>('./contributed/*.indicator.ts');

export type IndicatorPluginLoadFailure = {
  readonly file: string;
  readonly error: unknown;
};

export async function registerExternalIndicators(
  registry: IndicatorRegistry,
): Promise<readonly IndicatorPluginLoadFailure[]> {
  const modules = { ...userModules, ...contributedModules };
  const loaded = await Promise.all(Object.entries(modules).map(async ([file, load]) => {
    try {
      const module = await load();
      return { file, module } as const;
    } catch (error) {
      console.error('indicator.registration_failed', { file, error });
      return { file, error } satisfies IndicatorPluginLoadFailure;
    }
  }));
  const failures = loaded.filter((item): item is IndicatorPluginLoadFailure => 'error' in item);
  const successful = loaded
    .filter((item): item is { readonly file: string; readonly module: IndicatorModule } => 'module' in item)
    .sort((left, right) => left.file.localeCompare(right.file));
  for (const { file, module } of successful) {
    try {
      registry.register(module.default);
      console.info('indicator.registered', { file, indicatorId: module.default.id });
    } catch (error) {
      console.error('indicator.registration_failed', { file, error });
      failures.push({ file, error });
    }
  }
  return failures;
}

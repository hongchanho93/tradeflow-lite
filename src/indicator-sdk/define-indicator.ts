import type {
  IndicatorDefinition,
  IndicatorInputSchema,
  InferIndicatorInputs,
} from './contracts.ts';

/**
 * Defines an indicator while preserving the literal input schema for inference.
 * Runtime validation is deliberately owned by IndicatorRegistry.register().
 */
export function defineIndicator<const S extends IndicatorInputSchema>(
  definition: IndicatorDefinition<S>,
): IndicatorDefinition<S> {
  return definition;
}

export type { IndicatorDefinition, IndicatorInputSchema, InferIndicatorInputs } from './contracts.ts';

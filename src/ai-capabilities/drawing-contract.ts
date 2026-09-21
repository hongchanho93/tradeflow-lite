import {
  CapabilityError, type JsonValue, type ValueSchema,
} from './contracts.ts';
import { compileSchema, snapshotJson, validateValue } from './json.ts';
import { DRAWING_COLOR_FIELDS, normalizeDrawingColor } from './drawing-colors.ts';

/** Engineering defaults for the isolated transaction layer, not product quotas. */
export const DRAWING_LIMITS = Object.freeze({
  maxTypes: 32, maxPoints: 64, maxOperations: 32, maxObjects: 500,
  maxChanges: 64, maxPlanBytes: 128 * 1024, maxStoredBytes: 4 * 1024 * 1024,
  maxObjectBytes: 16 * 1024, proposalTtlMs: 5 * 60_000,
});

export type DrawingSpec = {
  readonly type: string;
  readonly points: readonly { readonly time: number; readonly price: number }[];
  readonly style: { readonly [key: string]: JsonValue };
};

export type DrawingSlot = {
  readonly id: string;
  /** Includes tombstones. Every successful write advances the version, even ABA. */
  readonly version: number;
  readonly value: DrawingSpec | null;
};

/** Trusted host port. A native adapter must prove every clause before activation. */
export interface DrawingDocumentPort {
  /** Return the same slot version for repeated reads, never reuse removed versions. */
  read(id: string): DrawingSlot;
  list(): readonly DrawingSlot[];
  /** Compare-and-set one object. Never replace the whole drawing document. */
  write(id: string, expectedVersion: number, value: DrawingSpec | null): void;
  /** Synchronous persistence barrier; throw on failure instead of swallowing it. */
  flush(): void;
  /** Native adapters may normalize price precision/defaults before showing a proposal. */
  normalize?(id: string, value: DrawingSpec): DrawingSpec;
  /** Include unsupported native drawings when enforcing the document capacity. */
  count?(): number;
  /** Optional native batch boundary preserves full native properties and layer order. */
  beginBatch?(batch: DrawingBatch): void;
  rollbackBatch?(): void;
  savedChange?(id: string): SavedDrawingChange | undefined;
  history?(): JsonValue;
}

export type DrawingBatch = {
  readonly id: string;
  readonly direction: 'apply' | 'revert';
  readonly context: import('./contracts.ts').SelectionRef;
  readonly deltas: readonly { readonly before: DrawingSlot; readonly after: DrawingSpec | null }[];
};

/** Recovered content is NOT an authorization grant. Only a separately granted tool uses it. */
export type SavedDrawingChange = {
  readonly id: string;
  readonly state: 'applied' | 'reverted';
  readonly before: readonly DrawingSlot[];
  readonly after: readonly DrawingSlot[];
};

export type DrawingTypeDefinition = {
  readonly type: string;
  readonly points: number;
  readonly maxPoints?: number;
  readonly styleSchema: Extract<ValueSchema, { type: 'object' }>;
};

export const emptyObjectSchema: ValueSchema = { type: 'object', properties: {}, additionalProperties: false };
export function objectSchema(properties: Record<string, ValueSchema>, required = Object.keys(properties)): ValueSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}
const numberSchema: ValueSchema = { type: 'number' };
const colorSchema: ValueSchema = { type: 'string', maxLength: 128 };
const lineStyle = {
  color: colorSchema, lineWidth: { type: 'number', minimum: 1, maximum: 64 } as ValueSchema,
  visible: { type: 'boolean' } as ValueSchema,
};

/** A few reference types; new trusted types register data, not model-specific tools. */
export const DEFAULT_DRAWING_TYPES: readonly DrawingTypeDefinition[] = [
  { type: 'HorizontalLine', points: 1, styleSchema: objectSchema(lineStyle, []) as DrawingTypeDefinition['styleSchema'] },
  { type: 'TrendLine', points: 2, styleSchema: objectSchema(lineStyle, []) as DrawingTypeDefinition['styleSchema'] },
  { type: 'Rectangle', points: 2, styleSchema: objectSchema({ ...lineStyle, fill: colorSchema }, []) as DrawingTypeDefinition['styleSchema'] },
  { type: 'Text', points: 1, styleSchema: objectSchema({
    color: colorSchema, visible: { type: 'boolean' }, text: { type: 'string', maxLength: 2048 },
    fontSize: { type: 'number', minimum: 8, maximum: 72 },
  }, ['text']) as DrawingTypeDefinition['styleSchema'] },
  ...['Ray','Arrow','ExtendedLine'].map(type => ({ type, points: 2, styleSchema: objectSchema(lineStyle, []) as DrawingTypeDefinition['styleSchema'] })),
  ...['HorizontalRay','VerticalLine','CrossLine'].map(type => ({ type, points: 1, styleSchema: objectSchema(lineStyle, []) as DrawingTypeDefinition['styleSchema'] })),
  { type: 'Callout', points: 2, styleSchema: objectSchema({ ...lineStyle, text: {type:'string',maxLength:2048},
    textColor: colorSchema, fontSize: {type:'number',minimum:8,maximum:72}, fill: colorSchema }, ['text']) as DrawingTypeDefinition['styleSchema'] },
  ...['Circle','Triangle','PriceRange'].map(type => ({ type, points: type==='Triangle'?3:2,
    styleSchema: objectSchema({ ...lineStyle, fill:colorSchema }, []) as DrawingTypeDefinition['styleSchema'] })),
  { type: 'ParallelChannel', points: 3, styleSchema: objectSchema({ ...lineStyle, fill:colorSchema,middleColor:colorSchema }, []) as DrawingTypeDefinition['styleSchema'] },
  { type: 'FibRetracement', points: 2, styleSchema: objectSchema({ lineWidth:lineStyle.lineWidth,visible:lineStyle.visible,
    levels:{type:'array',maxItems:32,items:objectSchema({coeff:{type:'number'},color:colorSchema,opacity:{type:'number',minimum:0,maximum:1}},['coeff','color'])} }, []) as DrawingTypeDefinition['styleSchema'] },
  ...['Brush','Highlighter','Path'].map(type => ({ type, points:2,maxPoints:64,styleSchema:objectSchema(lineStyle,[]) as DrawingTypeDefinition['styleSchema'] })),
  { type:'LongShortPosition',points:3,styleSchema:objectSchema({visible:lineStyle.visible,lineWidth:lineStyle.lineWidth,
    riskColor:colorSchema,targetColor:colorSchema,riskFill:colorSchema,targetFill:colorSchema},[]) as DrawingTypeDefinition['styleSchema'] },
  { type:'UpArrow',points:1,styleSchema:objectSchema({color:colorSchema,visible:lineStyle.visible,
    opacity:{type:'number',minimum:0,maximum:1},size:{type:'number',minimum:16,maximum:64}},[]) as DrawingTypeDefinition['styleSchema'] },
];

/** Descriptions/schemas are trusted registration data, never loaded from model output. */
export class DrawingTypeRegistry {
  readonly #types = new Map<string, DrawingTypeDefinition>();
  readonly schema: ValueSchema;

  constructor(definitions: readonly DrawingTypeDefinition[] = DEFAULT_DRAWING_TYPES) {
    if (!definitions.length || definitions.length > DRAWING_LIMITS.maxTypes) throw new CapabilityError('invalid_contract');
    const styles: Record<string, ValueSchema> = Object.create(null);
    for (const definition of definitions) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(definition.type) || this.#types.has(definition.type)
          || !Number.isSafeInteger(definition.points) || definition.points < 1
          || definition.points > DRAWING_LIMITS.maxPoints || definition.styleSchema.type !== 'object'
          || (definition.maxPoints !== undefined && (!Number.isSafeInteger(definition.maxPoints) || definition.maxPoints < definition.points || definition.maxPoints > DRAWING_LIMITS.maxPoints))) {
        throw new CapabilityError('invalid_contract');
      }
      const styleSchema = compileSchema(definition.styleSchema) as DrawingTypeDefinition['styleSchema'];
      for (const [name, schema] of Object.entries(styleSchema.properties)) {
        if (styles[name] && JSON.stringify(styles[name]) !== JSON.stringify(schema)) throw new CapabilityError('invalid_contract');
        styles[name] = schema;
      }
      this.#types.set(definition.type, Object.freeze({ type: definition.type, points: definition.points, styleSchema,
        ...(definition.maxPoints === undefined ? {} : {maxPoints:definition.maxPoints}) }));
    }
    this.schema = compileSchema(objectSchema({
      type: { type: 'string', enum: [...this.#types.keys()] },
      points: { type: 'array', maxItems: DRAWING_LIMITS.maxPoints, items: objectSchema({
        time: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, price: numberSchema,
      }) },
      style: objectSchema(styles, []),
    }));
  }

  validate(value: unknown): DrawingSpec {
    const frozen = snapshotJson(value, DRAWING_LIMITS.maxObjectBytes).value;
    validateValue(frozen, this.schema);
    const spec = frozen as unknown as DrawingSpec;
    const definition = this.#types.get(spec.type)!;
    if (spec.points.length < definition.points || spec.points.length > (definition.maxPoints ?? definition.points)) throw new CapabilityError('invalid_request');
    validateValue(spec.style, definition.styleSchema);
    const style = {...spec.style};
    for (const field of DRAWING_COLOR_FIELDS) if (style[field] !== undefined) style[field] = normalizeDrawingColor(style[field]);
    if (Array.isArray(style.levels)) {
      if (!style.levels.length) throw new CapabilityError('invalid_request');
      style.levels = style.levels.map(item => { const level=item as Record<string,JsonValue>;return {...level,color:normalizeDrawingColor(level.color)}; });
    }
    return snapshotJson({...spec,style},DRAWING_LIMITS.maxObjectBytes).value as unknown as DrawingSpec;
  }

  describe(): JsonValue {
    return [...this.#types.values()].map(type => ({
      type: type.type, points: type.points, schemaJson: JSON.stringify(type.styleSchema),
      ...(type.maxPoints === undefined ? {} : {maxPoints:type.maxPoints}),
    }));
  }
}

export function validDrawingId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_:-]{1,128}$/.test(id);
}

export function sameDrawing(a: DrawingSpec | null, b: DrawingSpec | null): boolean {
  return snapshotJson(a, DRAWING_LIMITS.maxObjectBytes).text === snapshotJson(b, DRAWING_LIMITS.maxObjectBytes).text;
}

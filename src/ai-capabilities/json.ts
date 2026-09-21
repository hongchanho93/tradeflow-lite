import { CAPABILITY_LIMITS, CapabilityError, type JsonValue, type ValueSchema } from './contracts.ts';

const encoder = new TextEncoder();
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

export class ValueValidationError extends CapabilityError {
  readonly path: string;
  readonly reason: string;
  readonly expected: string;
  constructor(path: string, reason: string, expected: string) {
    super('invalid_request');
    this.name = 'ValueValidationError';
    this.path = path.slice(0, 512);
    this.reason = reason.slice(0, 256);
    this.expected = expected.slice(0, 1024);
  }
}

function schemaExpectation(schema: ValueSchema): string {
  switch (schema.type) {
    case 'null': return 'null';
    case 'boolean': return 'boolean';
    case 'string': return schema.enum?.length
      ? `one of: ${schema.enum.join(', ')}`
      : `string${schema.maxLength === undefined ? '' : ` with at most ${schema.maxLength} characters`}`;
    case 'number': return `finite number${schema.minimum === undefined ? '' : ` >= ${schema.minimum}`}${schema.maximum === undefined ? '' : ` <= ${schema.maximum}`}`;
    case 'integer': return `safe integer${schema.minimum === undefined ? '' : ` >= ${schema.minimum}`}${schema.maximum === undefined ? '' : ` <= ${schema.maximum}`}`;
    case 'array': return `array${schema.maxItems === undefined ? '' : ` with at most ${schema.maxItems} items`}`;
    case 'object': return `object with fields: ${Object.keys(schema.properties).join(', ') || '(none)'}`;
  }
}

/** Copy/freeze plain JSON without running getters or toJSON; count actual UTF-8. */
export function snapshotJson(value: unknown, maxBytes: number): {
  readonly value: JsonValue; readonly text: string; readonly bytes: number;
} {
  const chunks: string[] = [];
  const ancestors = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  const invalid = (): never => { throw new CapabilityError('invalid_request'); };
  function append(text: string): void {
    if (text.length > maxBytes - bytes) invalid();
    bytes += encoder.encode(text).byteLength;
    if (bytes > maxBytes) invalid();
    chunks.push(text);
  }
  function string(text: string): void {
    if (text.length > maxBytes - bytes) invalid();
    append(JSON.stringify(text));
  }
  function visit(item: unknown, depth: number): JsonValue {
    if (++nodes > CAPABILITY_LIMITS.maxJsonNodes || depth > CAPABILITY_LIMITS.maxJsonDepth) invalid();
    if (item === null) { append('null'); return null; }
    if (typeof item === 'boolean') { append(String(item)); return item; }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalid();
      append(JSON.stringify(item));
      return item === 0 ? 0 : item;
    }
    if (typeof item === 'string') { string(item); return item; }
    if (typeof item !== 'object' || ancestors.has(item)) invalid();
    const object = item as object;
    const array = Array.isArray(object);
    const proto = Object.getPrototypeOf(object);
    if (!array && proto !== Object.prototype && proto !== null) invalid();
    if (Object.getOwnPropertySymbols(object).length !== 0) invalid();
    ancestors.add(object);
    const read = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
      return descriptor!.value;
    };
    let result: JsonValue;
    if (array) {
      const values = object as unknown[];
      if (values.length > CAPABILITY_LIMITS.maxJsonNodes
          || Object.getOwnPropertyNames(values).length !== values.length + 1) invalid();
      const copy: JsonValue[] = [];
      append('[');
      for (let i = 0; i < values.length; i += 1) {
        if (i > 0) append(',');
        copy.push(visit(read(String(i)), depth + 1));
      }
      append(']');
      result = Object.freeze(copy);
    } else {
      const keys = Object.getOwnPropertyNames(object).sort();
      if (keys.length > CAPABILITY_LIMITS.maxJsonNodes) invalid();
      const copy = Object.create(null) as Record<string, JsonValue>;
      append('{');
      keys.forEach((key, index) => {
        if (forbiddenKeys.has(key)) invalid();
        if (index > 0) append(',');
        string(key);
        append(':');
        copy[key] = visit(read(key), depth + 1);
      });
      append('}');
      result = Object.freeze(copy);
    }
    ancestors.delete(object);
    return result;
  }
  const copy = visit(value, 0);
  return Object.freeze({ value: copy, text: chunks.join(''), bytes });
}

export function parseJson(text: string, maxBytes: number): ReturnType<typeof snapshotJson> {
  if (typeof text !== 'string' || text.length > maxBytes || encoder.encode(text).byteLength > maxBytes) {
    throw new CapabilityError('invalid_request');
  }
  try {
    return snapshotJson(JSON.parse(text), maxBytes);
  } catch {
    throw new CapabilityError('invalid_request');
  }
}

function objectValue(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reject unsupported schema keywords instead of silently weakening validation. */
export function compileSchema(source: ValueSchema): ValueSchema {
  try {
    const frozen = snapshotJson(source, CAPABILITY_LIMITS.maxRequestBytes).value;
    function inspect(schema: JsonValue, depth: number): void {
      if (!objectValue(schema) || depth > 16) throw new Error();
      const allowed: Record<string, string[]> = {
        null: ['type'], boolean: ['type'], string: ['type', 'enum', 'maxLength'],
        number: ['type', 'minimum', 'maximum'], integer: ['type', 'minimum', 'maximum'],
        array: ['type', 'items', 'maxItems'], object: ['type', 'properties', 'required', 'additionalProperties'],
      };
      const type = schema.type;
      if (typeof type !== 'string' || !Object.hasOwn(allowed, type)
          || Object.keys(schema).some(key => !allowed[type].includes(key))) throw new Error();
      for (const key of ['maxLength', 'maxItems']) {
        if (schema[key] !== undefined && (!Number.isSafeInteger(schema[key]) || Number(schema[key]) < 0)) throw new Error();
      }
      for (const key of ['minimum', 'maximum']) {
        if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) throw new Error();
      }
      if (typeof schema.minimum === 'number' && typeof schema.maximum === 'number'
          && schema.minimum > schema.maximum) throw new Error();
      if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length
          || schema.enum.some(value => typeof value !== 'string')
          || new Set(schema.enum).size !== schema.enum.length)) throw new Error();
      if (type === 'array') inspect(schema.items, depth + 1);
      if (type === 'object') {
        if (!objectValue(schema.properties) || schema.additionalProperties !== false) throw new Error();
        if (schema.required !== undefined && (!Array.isArray(schema.required)
            || schema.required.some(key => typeof key !== 'string' || !Object.hasOwn(schema.properties as object, key))
            || new Set(schema.required).size !== schema.required.length)) throw new Error();
        Object.values(schema.properties).forEach(child => inspect(child, depth + 1));
      }
    }
    inspect(frozen, 0);
    return frozen as unknown as ValueSchema;
  } catch {
    throw new CapabilityError('invalid_contract');
  }
}

export function validateValue(value: JsonValue, schema: ValueSchema, path = '$'): void {
  const invalid = (reason: string, expected = schemaExpectation(schema)): never => {
    throw new ValueValidationError(path, reason, expected);
  };
  switch (schema.type) {
    case 'null': if (value !== null) invalid('type_mismatch'); return;
    case 'boolean': if (typeof value !== 'boolean') invalid('type_mismatch'); return;
    case 'string': {
      if (typeof value !== 'string') invalid('type_mismatch');
      const stringValue = value as string;
      if (schema.enum && !schema.enum.includes(stringValue)) invalid('unsupported_value');
      if (schema.maxLength !== undefined) {
        let characters = 0;
        for (const _character of stringValue) {
          if (++characters > schema.maxLength) invalid('max_length_exceeded');
        }
      }
      return;
    }
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) invalid('type_mismatch');
      {
        const numericValue = value as number;
        if (schema.type === 'integer' && !Number.isSafeInteger(numericValue)) invalid('type_mismatch');
        if (schema.minimum !== undefined && numericValue < schema.minimum) invalid('below_minimum');
        if (schema.maximum !== undefined && numericValue > schema.maximum) invalid('above_maximum');
      }
      return;
    case 'array': {
      if (!Array.isArray(value)) invalid('type_mismatch');
      const items = value as readonly JsonValue[];
      if (schema.maxItems !== undefined && items.length > schema.maxItems) invalid('max_items_exceeded');
      items.forEach((item, index) => validateValue(item, schema.items, `${path}[${index}]`));
      return;
    }
    case 'object': {
      if (!objectValue(value)) invalid('type_mismatch');
      const record = value as Record<string, JsonValue>;
      const missing = schema.required?.find(key => !Object.hasOwn(record, key));
      if (missing) throw new ValueValidationError(`${path}.${missing}`, 'required_field_missing', schemaExpectation(schema.properties[missing]));
      for (const [key, item] of Object.entries(record)) {
        if (!Object.hasOwn(schema.properties, key)) {
          throw new ValueValidationError(`${path}.${key}`, 'unexpected_field', `one of: ${Object.keys(schema.properties).join(', ') || '(none)'}`);
        }
        validateValue(item, schema.properties[key], `${path}.${key}`);
      }
    }
  }
}

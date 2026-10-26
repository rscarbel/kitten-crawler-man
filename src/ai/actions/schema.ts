/**
 * Typed parameter fields for AI actions. Each field is both the JSON Schema
 * the model is shown and the parser the game runs on what comes back, so the
 * two cannot drift: a tool definition is generated from the same objects the
 * executor reads its arguments through.
 */

import { plainLine } from '../../core/util/plainText';

export type JsonSchema =
  | {
      readonly type: 'string';
      readonly description: string;
      readonly enum?: readonly string[];
      readonly minLength?: number;
      readonly maxLength?: number;
      readonly default?: string;
    }
  | {
      readonly type: 'integer';
      readonly description: string;
      readonly minimum: number;
      readonly maximum: number;
      readonly default?: number;
    }
  | { readonly type: 'boolean'; readonly description: string; readonly default?: boolean };

export interface JsonObjectSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JsonSchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** One named argument of an action: its schema and how a raw value becomes a typed one. */
export interface ParamField<T> {
  readonly key: string;
  readonly required: boolean;
  readonly schema: JsonSchema;
  /** `raw` is `undefined` when the argument was left out. */
  parse(raw: unknown): ParseOutcome<T>;
}

function missing<T>(key: string): ParseOutcome<T> {
  return { ok: false, error: `${key} is required` };
}

/** A required choice from a fixed list. */
export function enumParam<const V extends string>(
  key: string,
  values: readonly V[],
  description: string,
): ParamField<V> {
  return {
    key,
    required: true,
    schema: { type: 'string', description, enum: values },
    parse(raw) {
      if (raw === undefined) return missing(key);
      const match = values.find((value) => value === raw);
      if (match === undefined)
        return { ok: false, error: `${key} must be one of the listed values` };
      return { ok: true, value: match };
    },
  };
}

/** An optional choice from a fixed list that falls back to `fallback` when left out. */
export function optionalEnumParam<const V extends string>(
  key: string,
  values: readonly V[],
  description: string,
  fallback: NoInfer<V>,
): ParamField<V> {
  const required = enumParam(key, values, description);
  return {
    key,
    required: false,
    schema: { type: 'string', description, enum: values, default: fallback },
    parse(raw) {
      if (raw === undefined) return { ok: true, value: fallback };
      return required.parse(raw);
    },
  };
}

interface IntBounds {
  readonly min: number;
  readonly max: number;
  readonly description: string;
}

function parseInteger(key: string, raw: unknown, bounds: IntBounds): ParseOutcome<number> {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return { ok: false, error: `${key} must be an integer` };
  }
  if (raw < bounds.min || raw > bounds.max) {
    return { ok: false, error: `${key} must be between ${bounds.min} and ${bounds.max}` };
  }
  return { ok: true, value: raw };
}

/** A required whole number inside `[min, max]`. */
export function intParam(key: string, bounds: IntBounds): ParamField<number> {
  return {
    key,
    required: true,
    schema: {
      type: 'integer',
      description: bounds.description,
      minimum: bounds.min,
      maximum: bounds.max,
    },
    parse(raw) {
      if (raw === undefined) return missing(key);
      return parseInteger(key, raw, bounds);
    },
  };
}

/** An optional whole number inside `[min, max]` that falls back to `fallback`. */
export function optionalIntParam(
  key: string,
  bounds: IntBounds & { readonly fallback: number },
): ParamField<number> {
  return {
    key,
    required: false,
    schema: {
      type: 'integer',
      description: bounds.description,
      minimum: bounds.min,
      maximum: bounds.max,
      default: bounds.fallback,
    },
    parse(raw) {
      if (raw === undefined) return { ok: true, value: bounds.fallback };
      return parseInteger(key, raw, bounds);
    },
  };
}

interface TextBounds {
  readonly minLength: number;
  readonly maxLength: number;
  readonly description: string;
}

function parseText(key: string, raw: unknown, bounds: TextBounds): ParseOutcome<string> {
  if (typeof raw !== 'string') return { ok: false, error: `${key} must be text` };
  const trimmed = plainLine(raw);
  if (trimmed.length < bounds.minLength) {
    return { ok: false, error: `${key} must be at least ${bounds.minLength} characters` };
  }
  if (trimmed.length > bounds.maxLength) {
    return { ok: false, error: `${key} must be at most ${bounds.maxLength} characters` };
  }
  return { ok: true, value: trimmed };
}

/** Required free text, flattened to one plain line (`plainLine`), inside the length bounds. */
export function textParam(key: string, bounds: TextBounds): ParamField<string> {
  return {
    key,
    required: true,
    schema: {
      type: 'string',
      description: bounds.description,
      minLength: bounds.minLength,
      maxLength: bounds.maxLength,
    },
    parse(raw) {
      if (raw === undefined) return missing(key);
      return parseText(key, raw, bounds);
    },
  };
}

/** Optional free text; an empty string when left out. */
export function optionalTextParam(key: string, bounds: TextBounds): ParamField<string> {
  return {
    key,
    required: false,
    schema: {
      type: 'string',
      description: bounds.description,
      minLength: bounds.minLength,
      maxLength: bounds.maxLength,
    },
    parse(raw) {
      if (raw === undefined) return { ok: true, value: '' };
      return parseText(key, raw, bounds);
    },
  };
}

/** The JSON Schema object for a list of fields, in the shape tool definitions carry. */
export function objectSchema(fields: readonly ParamField<unknown>[]): JsonObjectSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const field of fields) {
    properties[field.key] = field.schema;
    if (field.required) required.push(field.key);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/** Thrown by {@link ActionParams.get} for a field the action never declared. */
export class UndeclaredParamError extends Error {}

/**
 * The arguments of one action call, already checked against every declared
 * field by {@link validateParams}. `get` re-parses, which is cheap and keeps
 * the typed value flowing from the field itself rather than from a cast.
 */
export class ActionParams {
  constructor(
    private readonly raw: Readonly<Record<string, unknown>>,
    private readonly declared: ReadonlySet<string>,
  ) {}

  get<T>(field: ParamField<T>): T {
    if (!this.declared.has(field.key)) {
      throw new UndeclaredParamError(`parameter ${field.key} is not declared by this action`);
    }
    const outcome = field.parse(this.raw[field.key]);
    if (!outcome.ok) throw new UndeclaredParamError(outcome.error);
    return outcome.value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks raw arguments against an action's fields: every field parses and no
 * key is left over. Returns the reader on success, the first problem otherwise.
 */
export function validateParams(
  fields: readonly ParamField<unknown>[],
  raw: unknown,
): ParseOutcome<ActionParams> {
  const args = raw ?? {};
  if (!isRecord(args)) return { ok: false, error: 'parameters must be an object' };
  const declared = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(args)) {
    if (!declared.has(key)) return { ok: false, error: `unknown parameter ${key}` };
  }
  for (const field of fields) {
    const outcome = field.parse(args[field.key]);
    if (!outcome.ok) return { ok: false, error: outcome.error };
  }
  return { ok: true, value: new ActionParams(args, declared) };
}

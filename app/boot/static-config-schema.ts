import { canonicalJson } from '../../domains/workflow-contract/canonical.js';

export type StaticConfigType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null';

export type StaticConfigSchema =
  | boolean
  | {
      type?: StaticConfigType;
      properties?: Readonly<Record<string, StaticConfigSchema>>;
      required?: readonly string[];
      additionalProperties?: StaticConfigSchema;
      items?: StaticConfigSchema;
      enum?: readonly unknown[];
      const?: unknown;
    };

const SCHEMA_KEYS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
]);
const TYPES = new Set<StaticConfigType>([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertSchema(value: unknown, path: string): asserts value is StaticConfigSchema {
  if (typeof value === 'boolean') return;
  if (!isRecord(value)) throw new Error(`${path} must be a boolean or object`);
  const unknown = Object.keys(value).filter((key) => !SCHEMA_KEYS.has(key));
  if (unknown.length > 0)
    throw new Error(`${path} contains unsupported keys: ${unknown.join(', ')}`);
  if (
    value.type !== undefined &&
    (typeof value.type !== 'string' || !TYPES.has(value.type as StaticConfigType))
  ) {
    throw new Error(`${path}.type is unsupported`);
  }
  if (value.properties !== undefined) {
    if (!isRecord(value.properties)) throw new Error(`${path}.properties must be an object`);
    for (const [key, schema] of Object.entries(value.properties)) {
      assertSchema(schema, `${path}.properties.${key}`);
    }
  }
  if (value.required !== undefined) {
    if (
      !Array.isArray(value.required) ||
      value.required.some((item) => typeof item !== 'string' || !item)
    ) {
      throw new Error(`${path}.required must contain non-empty strings`);
    }
  }
  if (value.additionalProperties !== undefined && typeof value.additionalProperties !== 'boolean') {
    assertSchema(value.additionalProperties, `${path}.additionalProperties`);
  }
  if (value.items !== undefined) assertSchema(value.items, `${path}.items`);
  if (value.enum !== undefined && !Array.isArray(value.enum)) {
    throw new Error(`${path}.enum must be an array`);
  }
}

export function normalizeStaticConfigSchema(value: unknown): StaticConfigSchema {
  assertSchema(value, 'configSchema');
  return JSON.parse(canonicalJson(value)) as StaticConfigSchema;
}

function matchesType(value: unknown, type: StaticConfigType): boolean {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isRecord(value);
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value);
  return typeof value === type;
}

export function validateStaticPluginConfig(
  schema: StaticConfigSchema,
  value: unknown,
  path = 'config',
): void {
  if (schema === true) return;
  if (schema === false) throw new Error(`${path} is not allowed`);
  if (schema.type && !matchesType(value, schema.type)) {
    throw new Error(`${path} must be ${schema.type}`);
  }
  if (schema.const !== undefined && canonicalJson(value) !== canonicalJson(schema.const)) {
    throw new Error(`${path} must equal the declared constant`);
  }
  if (
    schema.enum &&
    !schema.enum.some((candidate) => canonicalJson(candidate) === canonicalJson(value))
  ) {
    throw new Error(`${path} is not one of the declared values`);
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) =>
      validateStaticPluginConfig(schema.items!, item, `${path}[${index}]`),
    );
  }
  if (!isRecord(value)) return;
  for (const required of schema.required ?? []) {
    if (!Object.hasOwn(value, required)) throw new Error(`${path}.${required} is required`);
  }
  const properties = schema.properties ?? {};
  for (const [key, item] of Object.entries(value)) {
    const child = properties[key];
    if (child !== undefined) {
      validateStaticPluginConfig(child, item, `${path}.${key}`);
      continue;
    }
    if (schema.additionalProperties === false) {
      throw new Error(`${path}.${key} is not allowed`);
    }
    if (schema.additionalProperties && typeof schema.additionalProperties !== 'boolean') {
      validateStaticPluginConfig(schema.additionalProperties, item, `${path}.${key}`);
    }
  }
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { parseDeliveryIntentV3 } from '../domains/delivery/v3.js';

type JsonSchema = Record<string, unknown>;

function schemaMatches(schema: JsonSchema, value: unknown): boolean {
  try {
    assertSchema(schema, value, '$');
    return true;
  } catch {
    return false;
  }
}

function assertSchema(schema: JsonSchema, value: unknown, location: string): void {
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    throw new Error(`${location} does not match const`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
    throw new Error(`${location} is not in enum`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((item) => schemaMatches(item as JsonSchema, value));
    if (matches.length !== 1) throw new Error(`${location} does not match exactly one schema`);
  }
  if (Array.isArray(schema.allOf)) {
    for (const item of schema.allOf) assertSchema(item as JsonSchema, value, location);
  }
  if (schema.if && schemaMatches(schema.if as JsonSchema, value)) {
    if (schema.then) assertSchema(schema.then as JsonSchema, value, location);
  } else if (schema.else) {
    assertSchema(schema.else as JsonSchema, value, location);
  }
  if (schema.type === 'null' && value !== null) throw new Error(`${location} must be null`);
  if (schema.type === 'string' || schema.pattern || schema.minLength) {
    if (typeof value !== 'string') throw new Error(`${location} must be a string`);
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      throw new Error(`${location} is too short`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      throw new Error(`${location} does not match its pattern`);
    }
  }
  if (
    schema.type === 'object' ||
    schema.properties ||
    schema.required ||
    schema.additionalProperties === false
  ) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${location} must be an object`);
    }
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in record)) throw new Error(`${location}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) throw new Error(`${location}.${key} is not allowed`);
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in record) assertSchema(propertySchema, record[key], `${location}.${key}`);
    }
  }
  if (
    schema.type === 'array' ||
    schema.items ||
    schema.contains ||
    schema.minItems ||
    schema.maxItems ||
    schema.uniqueItems
  ) {
    if (!Array.isArray(value)) throw new Error(`${location} must be an array`);
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      throw new Error(`${location} has too few items`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      throw new Error(`${location} has too many items`);
    }
    if (
      schema.uniqueItems === true &&
      new Set(value.map((item) => JSON.stringify(item))).size !== value.length
    ) {
      throw new Error(`${location} contains duplicate items`);
    }
    if (schema.items) {
      value.forEach((item, index) =>
        assertSchema(schema.items as JsonSchema, item, `${location}[${index}]`),
      );
    }
    if (
      schema.contains &&
      !value.some((item) => schemaMatches(schema.contains as JsonSchema, item))
    ) {
      throw new Error(`${location} does not contain a required item`);
    }
  }
}

const repositoryRoot = path.resolve(import.meta.dirname, '..');

describe('Delivery Intent v3 contract', () => {
  it('keeps the published example valid against both runtime parsing and JSON Schema', async () => {
    const [exampleSource, schemaSource] = await Promise.all([
      readFile(path.join(repositoryRoot, 'docs', 'examples', 'delivery-intent.yaml'), 'utf8'),
      readFile(path.join(repositoryRoot, 'docs', 'schemas', 'delivery-intent.schema.json'), 'utf8'),
    ]);
    const example = parse(exampleSource) as unknown;
    const schema = JSON.parse(schemaSource) as JsonSchema;

    expect(() => assertSchema(schema, example, '$')).not.toThrow();
    expect(parseDeliveryIntentV3(example)).toMatchObject({
      schemaVersion: 3,
      businessDeliveries: [{ deliveryId: 'primary' }],
    });

    const multiple = structuredClone(example) as {
      businessDeliveries: Array<Record<string, unknown>>;
    };
    multiple.businessDeliveries.push({
      ...multiple.businessDeliveries[0],
      deliveryId: 'secondary',
    });
    expect(() => assertSchema(schema, multiple, '$')).toThrow(/businessSplitReason is required/);

    const unnecessaryReason = {
      ...(example as Record<string, unknown>),
      businessSplitReason: { kind: 'multi_repository', summary: 'not needed for one MR' },
    };
    expect(() => assertSchema(schema, unnecessaryReason, '$')).toThrow(/too few items/);
  });

  it('documents the v3 approval request without the former Change MR fields', async () => {
    const schema = JSON.parse(
      await readFile(
        path.join(repositoryRoot, 'docs', 'schemas', 'human-decision-request.schema.json'),
        'utf8',
      ),
    ) as { required: string[]; properties: Record<string, unknown> };

    expect(schema.required).toEqual(
      expect.arrayContaining(['changeBranch', 'businessDeliveries', 'businessSplitReason']),
    );
    expect(schema.properties).not.toHaveProperty('changeMergeRequest');
    expect(schema.properties).not.toHaveProperty('repositories');
  });

  it('returns migration instructions instead of interpreting a v2 intent', () => {
    expect(() =>
      parseDeliveryIntentV3({
        schemaVersion: 2,
        changeId: 'legacy-change',
        changeMergeRequest: {},
        repositories: [],
      }),
    ).toThrow(/changeBranch.*remoteOid.*businessDeliveries.*deliveryId.*new planning approval/i);
  });
});

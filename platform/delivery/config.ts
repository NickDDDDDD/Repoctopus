import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';

import type { DeliveryPolicy } from '../../domains/delivery/types.js';
import { validateDeliveryPolicy } from '../../domains/delivery/validation.js';

export function parseDeliveryPolicy(source: string): DeliveryPolicy {
  const value = parse(source) as unknown;
  const findings = validateDeliveryPolicy(value);
  if (findings.length > 0) {
    throw new Error(
      `Invalid delivery policy:\n${findings.map((item) => `- ${item.path}: ${item.message}`).join('\n')}`,
    );
  }
  return value as DeliveryPolicy;
}

export async function loadDeliveryPolicy(file: string): Promise<DeliveryPolicy> {
  return parseDeliveryPolicy(await readFile(file, 'utf8'));
}

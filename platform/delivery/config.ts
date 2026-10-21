import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';

import type { DeliveryPolicy } from '../../domains/delivery/types.js';
import { validateDeliveryPolicy } from '../../domains/delivery/validation.js';
import { parseSharedProjectConfig } from '../../domains/project-configuration/config.js';

function validate(value: unknown): DeliveryPolicy {
  const findings = validateDeliveryPolicy(value);
  if (findings.length > 0) {
    throw new Error(
      `Invalid delivery policy:\n${findings.map((item) => `- ${item.path}: ${item.message}`).join('\n')}`,
    );
  }
  return value as DeliveryPolicy;
}

export function parseDeliveryPolicy(source: string): DeliveryPolicy {
  const value = parse(source) as unknown;
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === 'RepoctopusWorkspace'
  ) {
    const delivery = parseSharedProjectConfig(value).delivery;
    if (!delivery) throw new Error('Project configuration does not define delivery policy');
    return validate({
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'DeliveryPolicy',
      ...delivery,
    });
  }
  return validate(value);
}

export async function loadDeliveryPolicy(file: string): Promise<DeliveryPolicy> {
  return parseDeliveryPolicy(await readFile(file, 'utf8'));
}

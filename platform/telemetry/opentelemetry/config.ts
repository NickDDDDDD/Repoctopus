import type { Attributes } from '@opentelemetry/api';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

export type OtlpSignal = 'traces' | 'logs' | 'metrics';

export interface OtlpSignalConfiguration {
  enabled: boolean;
  url?: string;
  headers: Record<string, string>;
  timeoutMillis: number;
}

export interface OtlpDeploymentConfiguration {
  enabled: boolean;
  baseEndpoint?: string;
  traces: OtlpSignalConfiguration;
  logs: OtlpSignalConfiguration;
  metrics: OtlpSignalConfiguration;
}

const SIGNAL_ENV: Record<OtlpSignal, string> = {
  traces: 'TRACES',
  logs: 'LOGS',
  metrics: 'METRICS',
};

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value.trim());
  } catch {
    return null;
  }
}

function parseHeaders(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {};
  const headers: Record<string, string> = {};
  for (const entry of value.split(',')) {
    const separator = entry.indexOf('=');
    if (separator < 1) continue;
    const key = decode(entry.slice(0, separator));
    const headerValue = decode(entry.slice(separator + 1));
    if (!key || headerValue === null || /[\r\n]/u.test(key + headerValue)) continue;
    headers[key.toLowerCase()] = headerValue;
  }
  return headers;
}

function timeout(value: string | undefined, fallback = 5_000): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function signalUrl(base: string, signal: OtlpSignal): string {
  return `${base.replace(/\/+$/u, '')}/v1/${signal}`;
}

function signalConfiguration(
  signal: OtlpSignal,
  environment: NodeJS.ProcessEnv,
  baseEndpoint: string | undefined,
): OtlpSignalConfiguration {
  const suffix = SIGNAL_ENV[signal];
  const exact = environment[`OTEL_EXPORTER_OTLP_${suffix}_ENDPOINT`];
  const exactHeaders = environment[`OTEL_EXPORTER_OTLP_${suffix}_HEADERS`];
  const exactTimeout = environment[`OTEL_EXPORTER_OTLP_${suffix}_TIMEOUT`];
  const url = exact?.trim() || (baseEndpoint ? signalUrl(baseEndpoint, signal) : undefined);
  return {
    enabled: url !== undefined,
    ...(url ? { url } : {}),
    headers: parseHeaders(exactHeaders ?? environment.OTEL_EXPORTER_OTLP_HEADERS),
    timeoutMillis: timeout(exactTimeout, timeout(environment.OTEL_EXPORTER_OTLP_TIMEOUT)),
  };
}

export function resolveOtlpDeployment(
  environment: NodeJS.ProcessEnv = process.env,
  workspaceEndpoint?: string,
): OtlpDeploymentConfiguration {
  const baseEndpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || workspaceEndpoint;
  const traces = signalConfiguration('traces', environment, baseEndpoint);
  const logs = signalConfiguration('logs', environment, baseEndpoint);
  const metrics = signalConfiguration('metrics', environment, baseEndpoint);
  return {
    enabled: traces.enabled || logs.enabled || metrics.enabled,
    ...(baseEndpoint ? { baseEndpoint } : {}),
    traces,
    logs,
    metrics,
  };
}

function parseResourceAttributes(value: string | undefined): Attributes {
  const attributes: Attributes = {};
  if (!value?.trim()) return attributes;
  for (const entry of value.split(',')) {
    const separator = entry.indexOf('=');
    if (separator < 1) continue;
    const key = decode(entry.slice(0, separator));
    const resourceValue = decode(entry.slice(separator + 1));
    if (!key || resourceValue === null || /[\r\n]/u.test(key + resourceValue)) continue;
    attributes[key] = resourceValue;
  }
  return attributes;
}

export function createRepoctopusResource(
  defaultServiceName: string,
  version: string,
  environment: NodeJS.ProcessEnv = process.env,
): Resource {
  const deployment = parseResourceAttributes(environment.OTEL_RESOURCE_ATTRIBUTES);
  if (!(ATTR_DEPLOYMENT_ENVIRONMENT_NAME in deployment)) {
    deployment[ATTR_DEPLOYMENT_ENVIRONMENT_NAME] =
      environment.REPOCTOPUS_ENVIRONMENT?.trim() || 'development';
  }
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: defaultServiceName,
    [ATTR_SERVICE_VERSION]: version,
    ...deployment,
    ...(environment.OTEL_SERVICE_NAME?.trim()
      ? { [ATTR_SERVICE_NAME]: environment.OTEL_SERVICE_NAME.trim() }
      : {}),
    'repoctopus.product.name': 'repoctopus',
    'repoctopus.telemetry.schema': '1',
  });
}

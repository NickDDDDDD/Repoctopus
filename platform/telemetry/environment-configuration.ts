export const OTLP_ENDPOINT_VARIABLES = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
] as const;

export type OtlpEndpointVariable = (typeof OTLP_ENDPOINT_VARIABLES)[number];

export interface DevelopmentTelemetryConfiguration {
  schemaVersion: 1;
  remote: {
    enabled: boolean;
    configuredBy: OtlpEndpointVariable[];
  };
  desktop: {
    autostart: 'enabled' | 'disabled';
    replayOnNextDevelopmentRun: boolean;
  };
  deliverySemantics: 'at-least-once-replay';
}

function configuredEndpointVariables(
  environment: NodeJS.ProcessEnv,
  variables: readonly OtlpEndpointVariable[],
): OtlpEndpointVariable[] {
  return variables.filter((variable) => Boolean(environment[variable]?.trim()));
}

export function remoteTelemetryEnabled(
  environment: NodeJS.ProcessEnv = process.env,
  variables: readonly OtlpEndpointVariable[] = OTLP_ENDPOINT_VARIABLES,
): boolean {
  return configuredEndpointVariables(environment, variables).length > 0;
}

export function desktopAutostartEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.REPOCTOPUS_DESKTOP_AUTOSTART !== '0';
}

/**
 * Projects only public environment inputs into a safe diagnostic view. Endpoint
 * values are intentionally omitted because configuration inspection can enter
 * logs, bug reports, and CI output.
 */
export function developmentTelemetryConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): DevelopmentTelemetryConfiguration {
  const configuredBy = configuredEndpointVariables(environment, OTLP_ENDPOINT_VARIABLES);
  const desktopEnabled = desktopAutostartEnabled(environment);
  return {
    schemaVersion: 1,
    remote: {
      enabled: configuredBy.length > 0,
      configuredBy,
    },
    desktop: {
      autostart: desktopEnabled ? 'enabled' : 'disabled',
      replayOnNextDevelopmentRun: desktopEnabled,
    },
    deliverySemantics: 'at-least-once-replay',
  };
}

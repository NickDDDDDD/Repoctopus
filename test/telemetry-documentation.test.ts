import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './e2e/cli.js';
import {
  developmentTelemetryConfiguration,
  remoteTelemetryEnabled,
} from '../platform/telemetry/environment-configuration.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const publicTelemetryVariables = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  'REPOCTOPUS_DESKTOP_AUTOSTART',
  'REPOCTOPUS_ENVIRONMENT',
] as const;

interface EffectiveTelemetryConfiguration {
  schemaVersion: 1;
  remote: {
    enabled: boolean;
    configuredBy: string[];
  };
  desktop: {
    autostart: 'enabled' | 'disabled';
    replayOnNextDevelopmentRun: boolean;
  };
  deliverySemantics: 'at-least-once-replay';
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const variable of publicTelemetryVariables) delete environment[variable];
  return environment;
}

function documentedScenarios(documentation: string): Map<string, string> {
  const scenarios = new Map<string, string>();
  const pattern = /<!-- telemetry-smoke:([a-z-]+) -->\s*```powershell\r?\n([\s\S]*?)\r?\n```/gu;
  for (const match of documentation.matchAll(pattern)) scenarios.set(match[1]!, match[2]!);
  return scenarios;
}

function applyPowerShellEnvironment(block: string, environment: NodeJS.ProcessEnv): string[] {
  const command: string[] = [];
  for (const rawLine of block.split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const assignment = /^\$env:([A-Z0-9_]+)\s*=\s*'([^']*)'$/u.exec(line);
    if (assignment) {
      environment[assignment[1]!] = assignment[2]!;
      continue;
    }
    const removal = /^Remove-Item Env:([A-Z0-9_]+) -ErrorAction SilentlyContinue$/u.exec(line);
    if (removal) {
      delete environment[removal[1]!];
      continue;
    }
    const invocation = /^node bin\/repoctopus\.js (.+?)(?: --json)?$/u.exec(line);
    if (invocation) {
      command.push(...invocation[1]!.split(/\s+/u));
      continue;
    }
    throw new Error(`Unsupported command in telemetry documentation: ${line}`);
  }
  return command;
}

describe('telemetry development documentation', () => {
  it('uses non-empty standard endpoints and never returns endpoint values', () => {
    const environment = {
      OTEL_EXPORTER_OTLP_ENDPOINT: '   ',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://secret.example/v1/logs',
      REPOCTOPUS_DESKTOP_AUTOSTART: '0',
    };

    expect(remoteTelemetryEnabled(environment)).toBe(true);
    expect(developmentTelemetryConfiguration(environment)).toEqual({
      schemaVersion: 1,
      remote: {
        enabled: true,
        configuredBy: ['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'],
      },
      desktop: {
        autostart: 'disabled',
        replayOnNextDevelopmentRun: false,
      },
      deliverySemantics: 'at-least-once-replay',
    });
    expect(JSON.stringify(developmentTelemetryConfiguration(environment))).not.toContain(
      'secret.example',
    );
  });

  it('executes the four documented public-configuration scenarios', async () => {
    const documentation = await readFile(path.join(repositoryRoot, 'docs', 'telemetry.md'), 'utf8');
    const scenarios = documentedScenarios(documentation);
    expect([...scenarios.keys()]).toEqual([
      'remote-only',
      'remote-and-desktop',
      'desktop-closed',
      'desktop-recovered',
    ]);

    const environment = cleanEnvironment();
    const expected = [
      { name: 'remote-only', remote: true, desktop: 'disabled' },
      { name: 'remote-and-desktop', remote: true, desktop: 'enabled' },
      { name: 'desktop-closed', remote: true, desktop: 'disabled' },
      { name: 'desktop-recovered', remote: true, desktop: 'enabled' },
    ] as const;

    for (const scenario of expected) {
      const args = applyPowerShellEnvironment(scenarios.get(scenario.name)!, environment);
      const result = await runCli<EffectiveTelemetryConfiguration>({
        packageRoot: repositoryRoot,
        cwd: repositoryRoot,
        args,
        environment,
      });
      expect(result).toMatchObject({
        ok: true,
        command: 'telemetry config',
        result: {
          remote: { enabled: scenario.remote },
          desktop: { autostart: scenario.desktop },
          deliverySemantics: 'at-least-once-replay',
        },
      });
    }

    expect(
      (
        await runCli<EffectiveTelemetryConfiguration>({
          packageRoot: repositoryRoot,
          cwd: repositoryRoot,
          args: ['telemetry', 'config'],
          environment,
        })
      ).result?.desktop.replayOnNextDevelopmentRun,
    ).toBe(true);
  });
});

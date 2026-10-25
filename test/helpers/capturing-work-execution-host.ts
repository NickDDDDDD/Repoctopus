import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Context } from '@deepseek-ai/cordis';

import type { SpecificationArtifactKind } from '../../domains/specification/types.js';
import type {
  WorkExecutionHost,
  WorkExecutionPacket,
  WorkExecutionSessionIdentity,
} from '../../domains/work-execution/types.js';
import type { CommandHandler } from '../../services/command-router.js';

const codeDigest = `sha256:${'c'.repeat(64)}` as const;

export interface CapturedWorkInvocation {
  packet: WorkExecutionPacket;
  session: WorkExecutionSessionIdentity;
}

export interface CapturingHostOperation {
  repositoryId: string;
  relativePath: string;
  content: string;
  artifactKind?: SpecificationArtifactKind;
}

interface CapturingWriteInput extends CapturingHostOperation {
  hostId: string;
  session: WorkExecutionSessionIdentity;
  operationId: string;
}

export function installCapturingWorkExecutionHost(input: {
  context: Context;
  workspace: string;
  repositories: Readonly<Record<string, string>>;
  operations(packet: WorkExecutionPacket): readonly CapturingHostOperation[];
  afterOperations?(packet: WorkExecutionPacket): Promise<void>;
}): { invocations: CapturedWorkInvocation[]; dispose(): void } {
  const invocations: CapturedWorkInvocation[] = [];
  const commandName = 'test.capturing-host.write';
  const handler: CommandHandler<CapturingWriteInput, void> = {
    name: commandName,
    runtimeWork: (operation) =>
      operation.artifactKind
        ? {
            kind: 'specification-write' as const,
            hostId: operation.hostId,
            operationId: operation.operationId,
            session: operation.session,
            repositoryId: operation.repositoryId,
            path: operation.relativePath,
            operation: 'create' as const,
            providerId: 'openspec',
            artifactKind: operation.artifactKind,
            terminalArtifact: false,
          }
        : {
            kind: 'repository-file' as const,
            hostId: operation.hostId,
            operationId: operation.operationId,
            session: operation.session,
            repositoryId: operation.repositoryId,
            path: operation.relativePath,
            operation: 'create' as const,
          },
    execute: async ({ input: operation }) => {
      const root = input.repositories[operation.repositoryId];
      if (!root) throw new Error(`Unknown capture repository: ${operation.repositoryId}`);
      const absolute = path.resolve(root, operation.relativePath);
      const relative = path.relative(root, absolute);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Capturing Host operation escaped its repository');
      }
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, operation.content);
    },
  };
  const disposeCommand = input.context.commandRouter.register(handler);
  const host: WorkExecutionHost = {
    identity: {
      schemaVersion: 1,
      id: 'capturing-work-execution-host',
      version: '1.0.0-test',
      codeDigest,
      capabilities: [
        'repository.read',
        'repository.write',
        'process.execute',
        'evidence.write',
        'specification.read',
        'specification.write',
        'git.publish',
        'platform.mutate',
      ],
      actionKinds: ['agent'],
      reconcile: false,
    },
    preflight: (packet) =>
      Promise.resolve({
        accepted: Object.isFrozen(packet) && Object.isFrozen(packet.context.layers),
        reason: 'packet must be deeply frozen',
      }),
    async invoke(packet, session) {
      // Reading every content field is deliberate: this is the verifiable Host
      // consumption signal, not an inference from a later Work success.
      for (const layer of packet.context.layers) void layer.content.length;
      invocations.push({ packet, session });
      let operationIndex = 0;
      for (const operation of input.operations(packet)) {
        operationIndex += 1;
        await input.context.commandRouter.execute(commandName, {
          hostId: host.identity.id,
          session,
          operationId: `${session.invocationId}:write:${operationIndex}`,
          ...operation,
        });
      }
      await input.afterOperations?.(packet);
      return {
        schemaVersion: 1,
        invocationId: session.invocationId,
        hostId: host.identity.id,
        packetDigest: session.packetDigest,
        status: 'succeeded',
        summary: `Captured and consumed ${packet.context.layers.length} context layers`,
        consumedLayerDigests: packet.context.layers
          .filter((layer) => ['action-skill', 'augmentation-skill'].includes(layer.kind))
          .map((layer) => layer.digest),
        completedAt: new Date().toISOString(),
      };
    },
  };
  const disposeHost = input.context.workExecutionHosts.register(host);
  return {
    invocations,
    dispose() {
      disposeHost();
      disposeCommand();
    },
  };
}

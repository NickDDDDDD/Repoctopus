import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import type { WorkContextLayer } from '../../domains/change-lifecycle/work-context.js';
import {
  workspaceWorkflowSkillManifestPath,
  type WorkspaceEntryHost,
} from '../../domains/project-configuration/entry-skills.js';
import { BUILTIN_WORKFLOW_SKILL_NAMES } from '../../domains/skill/builtin-workflow-skills.js';
import type { WorkExecutionPacket } from '../../domains/work-execution/types.js';
import { workspaceSkillPath } from '../project-configuration/workspace-entry-skills.js';
import {
  installedSkillFiles,
  normalizeSkillFile,
  readExactSkillFile,
} from '../project-configuration/workspace-workflow-skills.js';

function digest(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function referencePath(
  packet: WorkExecutionPacket,
  layer: WorkContextLayer,
  host: WorkspaceEntryHost,
) {
  if (layer.kind !== 'action-skill' && layer.kind !== 'augmentation-skill') return undefined;
  if (!BUILTIN_WORKFLOW_SKILL_NAMES.includes(layer.source) || !layer.resources) return undefined;
  const bound = packet.work.skillComposition?.layers.find(
    ({ position }) => position === layer.skillOrder,
  );
  const snapshot =
    bound?.skill ??
    (layer.kind === 'action-skill'
      ? packet.work.actionSkill
      : packet.work.augmentationSkills.find(({ name }) => name === layer.source));
  if (
    bound?.origin === 'team' ||
    snapshot?.name !== layer.source ||
    snapshot.contentDigest !== layer.digest ||
    !['repoctopus-lifecycle', 'matt-builtins'].includes(snapshot.provider)
  )
    return undefined;
  return workspaceSkillPath(host, layer.source);
}

/** Check the exact bytes returned to the Host, including all bound resources. */
export async function readWorkspaceWorkSkill(
  workspace: string,
  packet: WorkExecutionPacket,
  layer: WorkContextLayer,
  host: WorkspaceEntryHost,
): Promise<{ path: string; layer: WorkContextLayer } | undefined> {
  const relative = referencePath(packet, layer, host);
  if (!relative) return undefined;
  try {
    const root = await realpath(workspace);
    const file = path.join(root, relative);
    const directory = path.dirname(file);
    const marker = path.join(root, workspaceWorkflowSkillManifestPath(relative));
    const owned = JSON.parse((await readExactSkillFile(marker)).toString('utf8')) as Record<
      string,
      string
    >;
    const actualFiles = await installedSkillFiles(directory);
    const expectedFiles = new Set(['SKILL.md', ...layer.resources!.map(({ path }) => path)]);
    if (
      actualFiles.length !== expectedFiles.size ||
      actualFiles.some((name) => !expectedFiles.has(name))
    )
      return undefined;
    const markdown = await readExactSkillFile(file);
    if (digest(normalizeSkillFile(markdown)) !== `sha256:${owned['SKILL.md']}`) return undefined;
    const content = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)([\s\S]*)$/u
      .exec(markdown.toString('utf8'))?.[1]
      ?.trim();
    if (!content || content.replaceAll('\r\n', '\n') !== layer.content.replaceAll('\r\n', '\n')) {
      return undefined;
    }
    const resources = await Promise.all(
      layer.resources!.map(async (resource) => {
        const bytes = await readExactSkillFile(path.join(directory, resource.path));
        const frozen = Buffer.from(resource.content, resource.encoding);
        const normalized = normalizeSkillFile(bytes);
        if (
          !normalized.equals(normalizeSkillFile(frozen)) ||
          digest(normalized) !== `sha256:${owned[resource.path]}`
        ) {
          throw new Error('Installed Skill resource identity changed');
        }
        return {
          ...resource,
          content: bytes.equals(frozen) ? bytes.toString(resource.encoding) : resource.content,
        };
      }),
    );
    return { path: relative, layer: { ...layer, resources } };
  } catch {
    return undefined;
  }
}

export async function workPacketReferenceView(
  workspace: string,
  packet: WorkExecutionPacket,
  host: WorkspaceEntryHost,
) {
  const layers = await Promise.all(
    packet.context.layers.map(async (layer) => {
      const reference = await readWorkspaceWorkSkill(workspace, packet, layer, host);
      if (!reference) return layer;
      const { content, resources, ...metadata } = layer;
      if (!content || !resources) return layer;
      return {
        ...metadata,
        reference: {
          path: reference.path,
          resources: resources.map(({ path, digest }) => ({ path, digest })),
        },
      };
    }),
  );
  return { ...packet, context: { ...packet.context, layers } };
}

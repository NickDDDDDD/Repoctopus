import type { Context, Plugin } from '@deepseek-ai/cordis';

import type {
  CredentialReference,
  PostMergeConfig,
} from '../../domains/project-configuration/types.js';
import { PostMergeActions } from '../../services/post-merge-actions.js';

export interface PostMergeActionsProviderConfig {
  workspaceRoot: string;
  temporaryRoot: string;
  verificationPathPrefixes: string[];
  publication: PostMergeConfig['publication'];
}

function credential(reference: CredentialReference, field: string): string {
  const value = process.env[reference.variable];
  if (!value) throw new Error(`Missing ${field} Credential: ${reference.variable}`);
  return value;
}

const plugin = ((context: Context, config: PostMergeActionsProviderConfig) => {
  new PostMergeActions(context, {
    workspaceRoot: config.workspaceRoot,
    temporaryRoot: config.temporaryRoot,
    verificationPathPrefixes: config.verificationPathPrefixes,
    publicationPolicy: () => ({
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'PostMergePublicationPolicy',
      operations: [...config.publication.operations],
      remote: config.publication.remote,
      commit: {
        message: config.publication.commit.message,
        authorName: credential(
          config.publication.commit.authorNameCredential,
          'Post-merge author name',
        ),
        authorEmail: credential(
          config.publication.commit.authorEmailCredential,
          'Post-merge author email',
        ),
      },
      mergeRequest: {
        title: config.publication.changeMergeRequest.title,
        body: config.publication.changeMergeRequest.body,
      },
    }),
  });
}) as Plugin;

Object.assign(plugin, {
  inject: PostMergeActions.inject,
  provide: 'postMergeActions',
});

export default plugin;

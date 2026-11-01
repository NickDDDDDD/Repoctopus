export type PublicationSideEffectStage = 'push' | 'merge-request';

export class PublicationResultUnknownError extends Error {
  readonly code = 'publication-result-unknown' as const;

  constructor(
    readonly publicationId: string,
    readonly stage: PublicationSideEffectStage,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'PublicationResultUnknownError';
  }
}

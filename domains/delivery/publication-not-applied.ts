import type { PublicationSideEffectStage } from './publication-result-unknown.js';

export type ExternalEffectCertainty = 'not-applied' | 'unknown';

export type PublicationNotAppliedReason =
  | 'authentication'
  | 'permission'
  | 'feature_unavailable'
  | 'not_found'
  | 'rate_limited'
  | 'invalid_response'
  | 'request_rejected';

interface ExternalEffectFailure {
  readonly effect: ExternalEffectCertainty;
  readonly code?: unknown;
}

const NOT_APPLIED_REASONS = new Set<PublicationNotAppliedReason>([
  'authentication',
  'permission',
  'feature_unavailable',
  'not_found',
  'rate_limited',
  'invalid_response',
  'request_rejected',
]);

export function externalEffectCertainty(error: unknown): ExternalEffectCertainty | null {
  if (!error || typeof error !== 'object' || !('effect' in error)) return null;
  const effect = (error as ExternalEffectFailure).effect;
  return effect === 'not-applied' || effect === 'unknown' ? effect : null;
}

export function publicationNotAppliedReason(error: unknown): PublicationNotAppliedReason {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'request_rejected';
  const code = (error as ExternalEffectFailure).code;
  return typeof code === 'string' && NOT_APPLIED_REASONS.has(code as PublicationNotAppliedReason)
    ? (code as PublicationNotAppliedReason)
    : 'request_rejected';
}

export class PublicationNotAppliedError extends Error {
  readonly code = 'publication-not-applied' as const;

  constructor(
    readonly publicationId: string,
    readonly stage: PublicationSideEffectStage,
    readonly reason: PublicationNotAppliedReason,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'PublicationNotAppliedError';
  }
}

import metadata from '../../package.json' with { type: 'json' };

/** Build-time product identity; independent of the consumer's working directory. */
export const PRODUCT_VERSION: string = metadata.version;

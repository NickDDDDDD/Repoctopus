export interface PackageContentDigest {
  sha256: string;
  files: number;
  bytes: number;
}

export function packageContentDigest(archive: Buffer): PackageContentDigest;

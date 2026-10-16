import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface ProvenanceEntry {
  source: string;
  sourceSha256: string;
  target: string;
  sha256: string;
  adoption: 'copied' | 'modified';
}

interface ProvenanceManifest {
  schemaVersion: number;
  upstream?: { commit?: string };
  files?: ProvenanceEntry[];
}

export interface ProvenanceCheck {
  valid: boolean;
  fileCount: number;
  findings: string[];
}

export async function checkProvenance(
  productRoot: string,
  upstreamRoot?: string,
): Promise<ProvenanceCheck> {
  const findings: string[] = [];
  const manifestPath = path.join(productRoot, 'third_party', 'comet', 'source-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ProvenanceManifest;
  if (
    manifest.schemaVersion !== 1 ||
    !manifest.upstream?.commit ||
    !Array.isArray(manifest.files)
  ) {
    return { valid: false, fileCount: 0, findings: ['Invalid provenance manifest header'] };
  }

  for (const entry of manifest.files) {
    if (
      typeof entry.source !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sourceSha256) ||
      typeof entry.target !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !['copied', 'modified'].includes(entry.adoption)
    ) {
      findings.push(`Invalid provenance entry: ${entry.target || '(missing target)'}`);
      continue;
    }
    const target = await readFile(path.join(productRoot, entry.target));
    const targetHash = createHash('sha256').update(target).digest('hex');
    if (targetHash !== entry.sha256) findings.push(`Target digest mismatch: ${entry.target}`);
    if (upstreamRoot) {
      const source = await readFile(path.join(upstreamRoot, entry.source));
      const sourceHash = createHash('sha256').update(source).digest('hex');
      if (sourceHash !== entry.sourceSha256)
        findings.push(`Source digest mismatch: ${entry.source}`);
    }
  }
  return { valid: findings.length === 0, fileCount: manifest.files.length, findings };
}

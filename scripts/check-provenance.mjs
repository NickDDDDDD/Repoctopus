import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.join(root, 'third_party', 'comet', 'source-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const findings = [];
if (manifest.schemaVersion !== 1 || !manifest.upstream?.commit || !Array.isArray(manifest.files)) {
  throw new Error('Invalid third_party/comet/source-manifest.json');
}
for (const entry of manifest.files) {
  if (
    typeof entry.source !== 'string' ||
    !/^[a-f0-9]{64}$/.test(entry.sourceSha256) ||
    typeof entry.target !== 'string' ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    !['copied', 'modified'].includes(entry.adoption)
  ) {
    findings.push(`Invalid provenance entry: ${entry.target ?? '(missing target)'}`);
    continue;
  }
  const target = await readFile(path.join(root, entry.target));
  if (createHash('sha256').update(target).digest('hex') !== entry.sha256) {
    findings.push(`Target digest mismatch: ${entry.target}`);
  }
  if (process.env.COMET_UPSTREAM_ROOT) {
    const source = await readFile(path.join(process.env.COMET_UPSTREAM_ROOT, entry.source));
    if (createHash('sha256').update(source).digest('hex') !== entry.sourceSha256) {
      findings.push(`Source digest mismatch: ${entry.source}`);
    }
  }
}
if (findings.length > 0) throw new Error(findings.join('\n'));
process.stdout.write(`Verified ${manifest.files.length} Comet-derived source files\n`);

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

async function sourceEntries(prefix: string) {
  const directory = path.join(root, ...prefix.split('/'));
  const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
  return Promise.all(
    files.map(async (file) => ({
      file: path.relative(root, file),
      content: await readFile(file, 'utf8'),
    })),
  );
}

async function sources(prefix: string): Promise<string> {
  return (await sourceEntries(prefix)).map(({ file, content }) => `${file}\n${content}`).join('\n');
}

describe('Desktop observation-only data source boundary', () => {
  it('keeps Renderer event-driven and unable to query a backend or filesystem', async () => {
    const renderer = await sources('app/desktop/renderer/');
    expect(renderer).not.toMatch(
      /from\s+['"]node:|\brequire\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|setInterval\s*\(/u,
    );
    expect(renderer).not.toMatch(
      /signoz|opentelemetry|FileRuntimeStore|from\s+['"][^'"]*openspec|[\\/]\.repoctopus(?:[\\/]|$)/iu,
    );
  });

  it('keeps Desktop Host file access limited to its own projection journal', async () => {
    const entries = await sourceEntries('app/desktop/host/');
    const host = entries.map(({ file, content }) => `${file}\n${content}`).join('\n');
    const filesystemImports = entries
      .filter(({ content }) => /from ['"]node:fs[^'"]*['"]/u.test(content))
      .map(({ file }) => file);
    expect(filesystemImports).toEqual([
      expect.stringContaining('app\\desktop\\host\\projection-journal-store.ts'),
    ]);
    expect(host).not.toMatch(
      /FileRuntimeStore|from\s+['"][^'"]*openspec|simple-git|git\s+status|OTEL_EXPORTER_OTLP_ENDPOINT|signoz/iu,
    );
  });
});

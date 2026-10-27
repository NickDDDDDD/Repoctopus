import { Buffer } from 'node:buffer';
import { appendFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import process from 'node:process';

const [outputFile, stateFile] = process.argv.slice(2);
if (!outputFile || !stateFile) throw new Error('output and state files are required');

const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8');
  const status = Number.parseInt(await readFile(stateFile, 'utf8'), 10);
  if (status >= 200 && status < 300) {
    await appendFile(
      outputFile,
      `${JSON.stringify({ path: request.url, contentType: request.headers['content-type'], body: JSON.parse(body) })}\n`,
    );
  }
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end('{}');
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('receiver address unavailable');
  process.stdout.write(`${JSON.stringify({ endpoint: `http://127.0.0.1:${address.port}` })}\n`);
});

async function stop() {
  server.closeIdleConnections();
  await new Promise((resolve) => server.close(resolve));
  process.exit(0);
}

process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

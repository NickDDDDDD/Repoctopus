import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const root = process.argv[2];
const repositories = new Set(['workspace', 'web-front', 'backend']);
const ledger = [];
const children = new Set();
const ingress = path.join(root, 'evidence', 'requests.jsonl');
const ledgerFile = path.join(root, 'evidence', 'pulls.json');
fs.writeFileSync(ledgerFile, '[]\n');

function record(service, request, repository, route) {
  fs.appendFileSync(
    ingress,
    JSON.stringify({
      service,
      method: request.method,
      repository,
      route,
    }) + '\n',
  );
}

function json(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function ref(repository, branch) {
  return execFileSync(
    'git',
    [
      '--git-dir',
      path.join(root, 'remotes', 'acceptance', repository + '.git'),
      'rev-parse',
      '--verify',
      'refs/heads/' + branch,
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
}

function gitRequest(request, response, url) {
  const match = /^\/acceptance\/([^/]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/u.exec(
    url.pathname,
  );
  if (!match || !repositories.has(match[1])) return json(response, {}, 404);
  if (request.method === 'POST') record('git', request, match[1], match[2]);
  const child = spawn('git', ['http-backend'], {
    windowsHide: true,
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: path.join(root, 'remotes'),
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: url.pathname,
      REQUEST_METHOD: request.method,
      QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: request.headers['content-type'] ?? '',
      CONTENT_LENGTH: request.headers['content-length'] ?? '',
      HTTP_GIT_PROTOCOL: request.headers['git-protocol'] ?? '',
      REMOTE_ADDR: '127.0.0.1',
      REMOTE_USER: 'fixture',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.add(child);
  child.stdin.on('error', () => {});
  request.pipe(child.stdin);
  let header = Buffer.alloc(0);
  child.stdout.on('data', (chunk) => {
    if (response.headersSent) {
      if (!response.write(chunk)) child.stdout.pause();
      return;
    }
    header = Buffer.concat([header, chunk]);
    let separator = header.indexOf('\r\n\r\n');
    let size = 4;
    if (separator < 0) {
      separator = header.indexOf('\n\n');
      size = 2;
    }
    if (separator < 0) return;
    let status = 200;
    for (const line of header.subarray(0, separator).toString('latin1').split(/\r?\n/u)) {
      const index = line.indexOf(':');
      const name = line.slice(0, index);
      const value = line.slice(index + 1).trim();
      if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0]);
      else if (index > 0) response.setHeader(name, value);
    }
    response.writeHead(status);
    if (!response.write(header.subarray(separator + size))) child.stdout.pause();
  });
  response.on('drain', () => child.stdout.resume());
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.on('error', (error) => {
    if (!response.headersSent) json(response, { message: error.message }, 500);
    else response.destroy(error);
  });
  child.on('close', () => {
    children.delete(child);
    if (!response.headersSent) json(response, { message: 'Git returned no headers' }, 500);
    else if (!response.writableEnded) response.end();
  });
}

async function apiRequest(request, response, url) {
  const match = /^\/api\/repos\/acceptance\/([^/]+)\/(.+)$/u.exec(url.pathname);
  if (!match || !repositories.has(match[1])) return json(response, {}, 404);
  const [, repository, route] = match;
  record('api', request, repository, route);
  if (request.headers.authorization !== 'Bearer local-fixture-only') return json(response, {}, 401);
  const items = ledger.filter((item) => item.repository === repository);
  if (request.method === 'GET' && route === 'pulls') {
    if (repository === 'workspace' && !fs.existsSync(path.join(root, 'reveal-pr'))) {
      return json(response, []);
    }
    return json(
      response,
      items.filter(
        (item) =>
          (!url.searchParams.has('head') ||
            url.searchParams.get('head') === 'acceptance:' + item.head.ref) &&
          (!url.searchParams.has('base') || url.searchParams.get('base') === item.base.ref),
      ),
    );
  }
  if (request.method === 'POST' && route === 'pulls') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    assert.equal(typeof body.title, 'string');
    assert.equal(typeof body.head, 'string');
    assert.equal(typeof body.base, 'string');
    if (items.some((item) => item.head.ref === body.head && item.base.ref === body.base)) {
      return json(response, { message: 'duplicate pull request' }, 422);
    }
    ref(repository, body.base);
    const number = ledger.length + 1;
    const item = {
      repository,
      number,
      title: body.title,
      body: body.body,
      html_url: 'https://github-fixture.localhost/acceptance/' + repository + '/pull/' + number,
      state: 'open',
      merged_at: null,
      merge_commit_sha: null,
      head: { ref: body.head, sha: ref(repository, body.head) },
      base: { ref: body.base },
    };
    ledger.push(item);
    fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
    if (repository === 'workspace' && !fs.existsSync(path.join(root, 'reveal-pr'))) {
      record('fault', request, repository, 'response-disconnected-after-create');
      request.socket.destroy();
      return;
    }
    return json(response, item, 201);
  }
  if (request.method === 'GET' && /^pulls\/\d+$/u.test(route)) {
    const item = items.find((entry) => entry.number === Number(route.split('/')[1]));
    return json(response, item ?? {}, item ? 200 : 404);
  }
  if (request.method === 'GET' && /^pulls\/\d+\/reviews$/u.test(route)) return json(response, []);
  if (request.method === 'GET' && /^commits\/[a-f0-9]+\/status$/u.test(route))
    return json(response, { state: 'success' });
  if (request.method === 'GET' && /^branches\/.+\/protection$/u.test(route))
    return json(response, {});
  return json(response, {}, 404);
}

const git = http.createServer((request, response) => {
  gitRequest(request, response, new URL(request.url, 'http://127.0.0.1'));
});
const api = https.createServer(
  {
    key: fs.readFileSync(path.join(root, 'key.pem')),
    cert: fs.readFileSync(path.join(root, 'cert.pem')),
  },
  (request, response) => {
    apiRequest(request, response, new URL(request.url, 'https://127.0.0.1')).catch((error) => {
      process.stderr.write(error.stack + '\n');
      if (!response.headersSent) json(response, { message: error.message }, 500);
      else response.destroy(error);
    });
  },
);

await Promise.all(
  [git, api].map(
    (server) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      }),
  ),
);
process.send({ gitPort: git.address().port, apiPort: api.address().port });
process.on('message', (message) => {
  if (message !== 'stop') return;
  for (const child of children) child.kill();
  for (const server of [git, api]) {
    server.close();
    server.closeAllConnections();
  }
  process.disconnect();
});

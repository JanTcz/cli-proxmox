// UC-3 — the transport speaks Proxmox's HTTPS API with a token (docs/features/01-read.md): the token header, GET/DELETE parameters in
// the query, POST/PUT as a form, booleans as 1/0, only the profile's CA trusted, `data` answered; errors with Proxmox's message and
// `errors`; a host that does not answer said apart from a slow one. A real HTTPS server with a certificate made here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import { createServer as createTcp } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transport } from '../src/transport.ts';

const dir = mkdtempSync(join(tmpdir(), 'cli-proxmox-tls-'));
after(() => { rmSync(dir, { recursive: true, force: true }); });
const cert = (name: string) => {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, `${name}.key`), '-out', join(dir, `${name}.pem`),
    '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  return { key: readFileSync(join(dir, `${name}.key`), 'utf8'), cert: readFileSync(join(dir, `${name}.pem`), 'utf8') };
};
const own = cert('own');
const other = cert('other');

type Heard = { method: string; url: string; auth: string | undefined; type: string | undefined; body: string };
const heard: Heard[] = [];
let answer: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":"ok"}'); };
const server = createServer({ key: own.key, cert: own.cert }, (req, res) => {
  let body = '';
  req.setEncoding('utf8').on('data', (chunk: string) => { body += chunk; }).on('end', () => {
    heard.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, type: req.headers['content-type'], body });
    answer(req, res);
  });
});
await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
after(() => { server.closeAllConnections(); server.close(); });
const url = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
const call = transport({ url, ca: own.cert, tokenId: 'cli@pve!lab', secret: 's3cret', timeoutMs: 2000 });

test('UC-3: the token header, GET parameters in the query, the answer\'s data', async () => {
  heard.length = 0;
  answer = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ vmid: 101 }] })); };
  assert.deepEqual(await call('GET', '/cluster/resources', { type: 'vm', full: true, skip: undefined }), [{ vmid: 101 }]);
  assert.equal(heard[0]?.url, '/api2/json/cluster/resources?type=vm&full=1');
  assert.equal(heard[0]?.auth, 'PVEAPIToken=cli@pve!lab=s3cret');
  await call('DELETE', '/a/b', { purge: false });
  assert.equal(heard[1]?.url, '/api2/json/a/b?purge=0');
});

test('UC-3: POST and PUT send their parameters as a form', async () => {
  heard.length = 0;
  answer = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":"UPID:pc:1"}'); };
  assert.equal(await call('POST', '/nodes/pc/qemu/101/status/shutdown', { timeout: 60, forceStop: true }), 'UPID:pc:1');
  await call('PUT', '/nodes/pc/qemu/101/config', {});
  assert.deepEqual(heard.map((h) => [h.method, h.url, h.type, h.body]), [
    ['POST', '/api2/json/nodes/pc/qemu/101/status/shutdown', 'application/x-www-form-urlencoded', 'timeout=60&forceStop=1'],
    ['PUT', '/api2/json/nodes/pc/qemu/101/config', 'application/x-www-form-urlencoded', ''],
  ]);
});

test('UC-3: an error status is said with Proxmox\'s message and its per-parameter errors', async () => {
  answer = (_req, res) => { res.writeHead(400, 'Parameter verification failed.', { 'content-type': 'application/json' }).end(JSON.stringify({ data: null, errors: { vmid: 'value must be at least 100' } })); };
  await assert.rejects(call('GET', '/nodes/pc/qemu/7/config', {}), /PVE 400 Parameter verification failed\.: vmid: value must be at least 100/u);
  answer = (_req, res) => { res.writeHead(500, 'storage busy', { 'content-type': 'application/json' }).end('{"data":null}'); };
  await assert.rejects(call('GET', '/x', {}), /PVE 500 storage busy$/u);
  answer = (_req, res) => { res.writeHead(403, 'Permission check failed (/vms/200, VM.Audit)').end(); };
  await assert.rejects(call('GET', '/nodes/pc/qemu/200/config', {}), /PVE 403 Permission check failed \(\/vms\/200, VM\.Audit\)$/u);
  answer = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }).end('not json'); };
  await assert.rejects(call('GET', '/x', {}), /PVE 200: the answer is not JSON: not json/u);
});

test('UC-3: only the profile\'s CA is trusted', async () => {
  const stranger = transport({ url, ca: other.cert, tokenId: 'cli@pve!lab', secret: 's', timeoutMs: 2000 });
  await assert.rejects(stranger('GET', '/version', {}), new RegExp(`cannot reach ${url.replaceAll('.', '\\.')}: .*(certificate|self.signed)`, 'iu'));
});

test('UC-3: a host that does not answer at all is said apart from a slow one', async () => {
  const closed = createTcp();
  await new Promise<void>((resolve) => { closed.listen(0, '127.0.0.1', resolve); });
  const port = (closed.address() as { port: number }).port;
  await new Promise<void>((resolve) => { closed.close(() => { resolve(); }); });
  const nobody = transport({ url: `https://127.0.0.1:${port}`, ca: own.cert, tokenId: 'a', secret: 'b', timeoutMs: 2000 });
  await assert.rejects(nobody('GET', '/version', {}), new RegExp(`cannot reach https://127\\.0\\.0\\.1:${port}: ECONNREFUSED`, 'u'));
  // It never answers.
  answer = () => {};
  const slow = transport({ url, ca: own.cert, tokenId: 'a', secret: 'b', timeoutMs: 200 });
  await assert.rejects(slow('GET', '/version', {}), new RegExp(`${url.replaceAll('.', '\\.')} gave no answer in 200 ms`, 'u'));
});

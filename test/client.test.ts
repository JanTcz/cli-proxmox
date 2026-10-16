// UC-2 — the typed client calls the path it names (docs/features/01-read.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api/client.ts';
import { fakePve, NODE } from './fake-pve.ts';

test('UC-2: a property chain is the path, $(value) a segment, the last $method the call', async () => {
  const { call, seen } = fakePve();
  const pve = api(call);
  const current = await pve.nodes.$(NODE).qemu.$(101).status.current.$get();
  assert.equal(current.qmpstatus, 'io-error');
  await pve.cluster.resources.$get({ type: 'vm' });
  assert.deepEqual(seen, [
    { method: 'GET', path: `/nodes/${NODE}/qemu/101/status/current`, params: {} },
    { method: 'GET', path: '/cluster/resources', params: { type: 'vm' } },
  ]);
});

test('UC-2: every method is sent as it is named, and a segment is URL-encoded', async () => {
  const { call, seen } = fakePve({ 'POST /a/x%2Fy%3Az': 1, 'PUT /a': 2, 'DELETE /a': 3 });
  const pve = api(call) as unknown as Record<string, any>;
  assert.equal(await pve['a'].$('x/y:z').$post({ k: 1 }), 1);
  assert.equal(await pve['a'].$put(), 2);
  assert.equal(await pve['a'].$delete(), 3);
  assert.deepEqual(seen.map((s) => [s.method, s.path, s.params]), [['POST', '/a/x%2Fy%3Az', { k: 1 }], ['PUT', '/a', {}], ['DELETE', '/a', {}]]);
});

test('UC-2: the client is not a thenable — awaiting a path does not call it', async () => {
  const { call, seen } = fakePve();
  const node = api(call).nodes;
  assert.equal((node as unknown as { then?: unknown }).then, undefined);
  assert.equal(await Promise.resolve(node), node);
  assert.deepEqual(seen, []);
});

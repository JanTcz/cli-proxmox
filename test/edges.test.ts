// The edges of slice 1 (docs/features/01-read.md) that the use cases' own tests do not reach: answers with fields Proxmox may leave
// out (a guest on an offline node, an inactive storage), a container, a write refused by the tier, the encodings of a form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api/client.ts';
import { type Operation, OPERATIONS } from '../src/catalog.ts';
import { run } from '../src/cli.ts';
import { mcpServer } from '../src/mcp.ts';
import { fenceOf } from '../src/policy.ts';
import type { Profile } from '../src/profile.ts';
import { form } from '../src/transport.ts';
import { fakePve, NODE } from './fake-pve.ts';

const PROFILE: Profile = { name: 'lab', url: 'https://pve:8006', ca: 'PEM', tokenId: 'cli@pve!lab', secret: 's', tier: 'read' };

async function cli(argv: string[], overrides: Record<string, unknown> = {}, operations: readonly Operation[] = OPERATIONS) {
  const { call } = fakePve(overrides);
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (line) => out.push(line), err: (line) => err.push(line) }, () => ({ pve: api(call), profile: PROFILE }), operations);
  return { code, out, err };
}

test('a guest Proxmox says little of is listed with "-" for what it left out', async () => {
  const { out } = await cli(['vm', 'ls'], { 'GET /cluster/resources': [{ id: 'qemu/300', vmid: 300, mem: 0 }] });
  assert.match(out[1]!, /^300\s+-\s+-\s+-\s+-\s+-\s+0\.0\/-\s+-$/u);
});

test('vm show of a guest whose status names no QEMU state nor cpus says so; a container is not shown', async () => {
  const { out } = await cli(['vm', 'show', '101'], { [`GET /nodes/${NODE}/qemu/101/status/current`]: { status: 'stopped', mem: 0, vmid: 101 } });
  assert.equal(out[0], '101 devserv-master on pc: stopped, QEMU unknown');
  assert.equal(out[1], 'cpu - of -, memory 0.0/-, uptime -');
  const nameless = await cli(['vm', 'show', '300'], { 'GET /cluster/resources': [{ id: 'qemu/300', vmid: 300, type: 'qemu', node: NODE }],
    [`GET /nodes/${NODE}/qemu/300/status/current`]: { status: 'stopped', qmpstatus: 'stopped', mem: 0, vmid: 300 }, [`GET /nodes/${NODE}/qemu/300/config`]: {} });
  assert.equal(nameless.out[0], '300 - on pc: stopped, QEMU stopped');
  const container = await cli(['vm', 'show', '300'], { 'GET /cluster/resources': [{ id: 'lxc/300', vmid: 300, type: 'lxc', node: NODE }] });
  assert.deepEqual(container.err, ['proxmox: VM 300 is a lxc: only QEMU VMs are shown']);
  const untyped = await cli(['vm', 'show', '300'], { 'GET /cluster/resources': [{ id: 'x/300', vmid: 300, node: NODE }] });
  assert.deepEqual(untyped.err, ['proxmox: VM 300 is a guest: only QEMU VMs are shown']);
});

test('an inactive storage, with no use known, is listed with "-"', async () => {
  const { out } = await cli(['storage', 'ls'], { [`GET /nodes/${NODE}/storage`]: [{ storage: 'nfs', type: 'nfs', content: 'backup', active: 0 }] });
  assert.match(out[1]!, /^pc\s+nfs\s+nfs\s+-\s+-\s+-\s+backup$/u);
});

test('a command given an argument it does not take is usage', async () => {
  const { code, err } = await cli(['next-id', '7']);
  assert.equal(code, 2);
  assert.deepEqual(err, ['proxmox: next-id takes no argument', 'usage: proxmox next-id']);
});

test('an operation above the profile\'s tier is refused before it runs', async () => {
  let ran = false;
  const write: Operation = { words: 'vm start', args: ['vmid'], flags: [], tier: 'write', summary: 's', run: () => { ran = true; return Promise.resolve({ json: null, lines: [] }); } };
  const { code, err } = await cli(['vm', 'start', '101'], {}, [write]);
  assert.equal(code, 1);
  assert.deepEqual(err, ['proxmox: the profile lab allows read; this is a write']);
  assert.equal(ran, false);
});

test('the MCP twin refuses a json that is not a boolean, and sends a flag only when given', async () => {
  const ran: string[][] = [];
  const handle = mcpServer(OPERATIONS, (argv) => { ran.push(argv); return Promise.resolve(0); }, '0');
  const bad = JSON.parse((await handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'thin_ls', arguments: { json: 'yes' } } })))!) as { error: unknown };
  assert.deepEqual(bad.error, { code: -32_602, message: 'thin_ls: json is a boolean' });
  await handle(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'thin_ls', arguments: { json: false } } }));
  assert.deepEqual(ran, [['thin', 'ls']]);
});

test('a fence is said as it is: vmids alone, pool and vmids', () => {
  assert.equal(fenceOf({ ...PROFILE, vmids: [100, 102] }), 'vmids 100, 102');
  assert.equal(fenceOf({ ...PROFILE, pool: 'codiak', vmids: [200] }), 'pool codiak, vmids 200');
});

test('a form: a list is a key repeated, false is 0, undefined is left out', () => {
  assert.equal(form({ delete: ['net1', 'ipconfig1'], onboot: false, name: undefined, cores: 2 }), 'delete=net1&delete=ipconfig1&onboot=0&cores=2');
});

// UC-5, UC-6 — the read commands and their scope (docs/features/01-read.md), through the CLI as a person or a model calls it, on the
// fake Proxmox (test/fake-pve.ts, the lab host's own answers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api/client.ts';
import { type Opened, run } from '../src/cli.ts';
import type { Profile } from '../src/profile.ts';
import { fakePve, NODE, UPID } from './fake-pve.ts';

const PROFILE: Profile = { name: 'lab', url: 'https://pve:8006', ca: 'PEM', tokenId: 'cli@pve!lab', secret: 's', tier: 'read' };

async function cli(argv: string[], profile: Partial<Profile> = {}, overrides: Record<string, unknown> = {}) {
  const { call, seen } = fakePve(overrides);
  const out: string[] = [];
  const err: string[] = [];
  const asked: (string | undefined)[] = [];
  const open = (name: string | undefined): Opened => {
    asked.push(name);
    return { pve: api(call), profile: { ...PROFILE, ...profile } };
  };
  const code = await run(argv, { out: (line) => out.push(line), err: (line) => err.push(line) }, open);
  return { code, out, err, seen, asked };
}

test('UC-6: vm ls — a table of the guests, the whole answer as JSON with --json', async () => {
  const { code, out, seen } = await cli(['vm', 'ls']);
  assert.equal(code, 0);
  assert.match(out[0]!, /^VMID\s+NAME\s+TYPE\s+STATUS\s+NODE\s+CPU\s+MEM\s+UPTIME$/u);
  assert.match(out.find((line) => line.startsWith('101'))!, /^101\s+devserv-master\s+qemu\s+running\s+pc\s+1\.2%\s+4\.0\/9\.0 GiB\s+1h 0m$/u);
  assert.equal(out.length, 5, 'a header and the four guests');
  assert.deepEqual(seen, [{ method: 'GET', path: '/cluster/resources', params: { type: 'vm' } }]);
  const json = await cli(['vm', 'ls', '--json']);
  assert.deepEqual((JSON.parse(json.out.join('\n')) as { vmid: number }[]).map((r) => r.vmid), [100, 101, 102, 200]);
});

test('UC-5: a profile\'s vmids or pool fence what vm ls lists', async () => {
  const byIds = await cli(['vm', 'ls'], { vmids: [100, 102] });
  assert.deepEqual(byIds.out.slice(1).map((line) => line.split(/\s+/u)[0]), ['100', '102']);
  const byPool = await cli(['vm', 'ls'], { pool: 'codiak' });
  assert.deepEqual(byPool.out.slice(1).map((line) => line.split(/\s+/u)[0]), ['101', '102']);
  const both = await cli(['vm', 'ls'], { pool: 'codiak', vmids: [200] });
  assert.deepEqual(both.out.slice(1).map((line) => line.split(/\s+/u)[0]), ['101', '102', '200'], 'either fence admits');
});

test('UC-6: vm show — the guest, its QEMU state (an I/O error is not "running"), its config', async () => {
  const { code, out, seen } = await cli(['vm', 'show', '101']);
  assert.equal(code, 0, out.join('\n'));
  assert.equal(out[0], '101 devserv-master on pc: running, QEMU io-error');
  assert.match(out[1]!, /^cpu 1\.2% of 4, memory 4\.0\/9\.0 GiB, uptime 1h 0m$/u);
  assert.ok(out.includes('  ipconfig0: ip=192.168.0.41/24,gw=192.168.0.1'), out.join('\n'));
  assert.ok(out.includes('  onboot: 1'));
  assert.deepEqual(seen.map((s) => s.path), ['/cluster/resources', `/nodes/${NODE}/qemu/101/status/current`, `/nodes/${NODE}/qemu/101/config`]);
  const json = JSON.parse((await cli(['vm', 'show', '101', '--json'])).out.join('\n')) as { status: { qmpstatus: string }; config: { onboot: number } };
  assert.equal(json.status.qmpstatus, 'io-error');
  assert.equal(json.config.onboot, 1);
});

test('UC-5: vm show of a guest outside the profile\'s scope is refused before it is read; an unknown one is said', async () => {
  const outside = await cli(['vm', 'show', '200'], { pool: 'codiak' });
  assert.equal(outside.code, 1);
  assert.deepEqual(outside.err, ['proxmox: VM 200 is outside the profile lab (pool codiak)']);
  assert.deepEqual(outside.seen.map((s) => s.path), ['/cluster/resources'], 'nothing of 200 was read');
  const unknown = await cli(['vm', 'show', '999']);
  assert.deepEqual(unknown.err, ['proxmox: no VM 999']);
  const bad = await cli(['vm', 'show', 'x1']);
  assert.equal(bad.code, 2);
  assert.match(bad.err[0]!, /vmid is a whole number/u);
});

test('UC-6: storage ls and thin ls — use per storage, LVM-thin data and metadata, flagged over the threshold', async () => {
  const storage = await cli(['storage', 'ls']);
  assert.match(storage.out[0]!, /^NODE\s+STORAGE\s+TYPE\s+USED\s+TOTAL\s+USE%\s+CONTENT$/u);
  assert.match(storage.out[2]!, /^pc\s+local-lvm\s+lvmthin\s+166\.7 GiB\s+353\.9 GiB\s+47\.1%\s+rootdir,images$/u);
  const thin = await cli(['thin', 'ls']);
  assert.match(thin.out[0]!, /^NODE\s+VG\s+LV\s+DATA\s+META$/u);
  assert.match(thin.out[1]!, /^pc\s+pve\s+data\s+47\.1%\s+2\.1%$/u);
  const warned = await cli(['thin', 'ls', '--warn', '40']);
  assert.match(warned.out[1]!, /^pc\s+pve\s+data\s+47\.1%\s+2\.1%\s+over 40%$/u);
  const json = JSON.parse((await cli(['thin', 'ls', '--json'])).out.join('\n')) as { node: string; data: number; metadata: number; over: boolean }[];
  assert.deepEqual(json.map(({ node, over }) => [node, over]), [['pc', false]]);
  const wrong = await cli(['thin', 'ls', '--warn', '120']);
  assert.equal(wrong.code, 2);
  assert.match(wrong.err[0]!, /warn is a percent, 1 to 100/u);
});

test('UC-6: task show and next-id', async () => {
  const task = await cli(['task', 'show', UPID]);
  assert.equal(task.code, 0, task.err.join('\n'));
  assert.deepEqual(task.out, [UPID, 'qmstart 115 by root@pam on pc: stopped, OK', 'started 2026-10-16 18:36:38 UTC']);
  const running = await cli(['task', 'show', UPID], {}, { [`GET /nodes/${NODE}/tasks/${encodeURIComponent(UPID)}/status`]: { id: '', node: NODE, starttime: 1_792_175_798, status: 'running', type: 'vzdump', upid: UPID, user: 'root@pam' } });
  assert.equal(running.out[1], 'vzdump by root@pam on pc: running');
  const bad = await cli(['task', 'show', 'nope']);
  assert.equal(bad.code, 2);
  assert.match(bad.err[0]!, /upid is a task id, UPID:<node>:…/u);
  assert.deepEqual((await cli(['next-id'])).out, ['105']);
});

test('UC-6: usage — no command, an unknown one, a missing argument, an unknown flag, --help', async () => {
  for (const argv of [[], ['vm'], ['vm', 'eat'], ['vm', 'show'], ['vm', 'ls', '--colour', 'red'], ['thin', 'ls', '--warn']]) {
    const { code, err } = await cli(argv);
    assert.equal(code, 2, argv.join(' '));
    assert.match(err.join('\n'), /usage: proxmox/u, argv.join(' '));
  }
  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.ok(help.out.some((line) => /^ {2}vm show <vmid>\s+read\s+/u.test(line)), help.out.join('\n'));
});

test('UC-5: an operation above the profile\'s tier is refused by name before any request', async () => {
  const { refusal } = await import('../src/policy.ts');
  assert.equal(refusal('write', { ...PROFILE, tier: 'read' }), 'the profile lab allows read; this is a write');
  assert.equal(refusal('destructive', { ...PROFILE, tier: 'write' }), 'the profile lab allows write; this is a destructive');
  assert.equal(refusal('read', PROFILE), undefined);
  assert.equal(refusal('write', { ...PROFILE, tier: 'destructive' }), undefined);
});

test('UC-4: the profile named by --profile is the one opened; a failure is one line and exit 1', async () => {
  const { asked } = await cli(['--profile', 'ops', 'next-id']);
  assert.deepEqual(asked, ['ops']);
  const broken = await cli(['next-id'], {}, { 'GET /cluster/nextid': new Error('PVE 500 boom') });
  assert.equal(broken.code, 1);
  assert.deepEqual(broken.err, ['proxmox: PVE 500 boom']);
});

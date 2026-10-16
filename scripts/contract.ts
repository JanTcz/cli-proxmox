// npm run contract [-- --profile <name>]: the read commands against a real Proxmox VE, through the CLI as it is called, each answer's
// shape checked against what the commands and the fakes (test/fake-pve.ts) assume. Not part of the check: it needs the host.
import assert from 'node:assert/strict';
import { api } from '../src/api/client.ts';
import { type Opened, run } from '../src/cli.ts';
import { configDir, loadProfile } from '../src/profile.ts';
import { transport } from '../src/transport.ts';

const at = process.argv.indexOf('--profile');
const name = at === -1 ? undefined : process.argv[at + 1];
const profile = loadProfile(configDir(), name);
const pve = api(transport({ url: profile.url, ca: profile.ca, tokenId: profile.tokenId, secret: profile.secret, timeoutMs: 30_000 }));
const open = (): Opened => ({ pve, profile });

async function json(argv: string[]): Promise<any> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run([...argv, '--json'], { out: (line) => out.push(line), err: (line) => err.push(line) }, open);
  assert.equal(code, 0, `${argv.join(' ')}: ${err.join(' ')}`);
  return JSON.parse(out.join('\n'));
}
const has = (what: string, value: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) assert.ok(key in value, `${what}: no ${key} in ${JSON.stringify(value).slice(0, 300)}`);
};

const checks: [string, () => Promise<void>][] = [
  ['vm ls', async () => {
    const guests = await json(['vm', 'ls']) as Record<string, unknown>[];
    assert.ok(guests.length > 0, 'the profile sees no guest');
    for (const guest of guests) has('vm ls', guest, ['vmid', 'name', 'type', 'status', 'node', 'cpu', 'mem', 'maxmem', 'uptime']);
  }],
  ['vm show', async () => {
    const [first] = await json(['vm', 'ls']) as { vmid: number }[];
    const shown = await json(['vm', 'show', String(first!.vmid)]);
    has('vm show status', shown.status, ['status', 'qmpstatus', 'cpus', 'mem', 'maxmem', 'uptime']);
    assert.ok(Object.keys(shown.config).length > 0, 'vm show: an empty config');
  }],
  ['storage ls', async () => { for (const s of await json(['storage', 'ls'])) has('storage ls', s, ['node', 'storage', 'type', 'content']); }],
  ['thin ls', async () => { for (const p of await json(['thin', 'ls'])) has('thin ls', p, ['node', 'vg', 'lv', 'data', 'metadata', 'over']); }],
  ['task show', async () => {
    const [task] = await pve.cluster.tasks.$get();
    assert.ok(task, 'the cluster names no task to show');
    has('task show', await json(['task', 'show', task.upid]), ['upid', 'type', 'user', 'node', 'status', 'starttime']);
  }],
  ['next-id', async () => { assert.match(String(await json(['next-id'])), /^\d+$/u); }],
];

let failed = 0;
for (const [what, check] of checks) {
  try {
    // oxlint-disable-next-line no-await-in-loop -- one command after another against the host
    await check();
    console.log(`ok    ${what}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${what}: ${(error as Error).message}`);
  }
}
console.log(`${checks.length - failed} of ${checks.length} held on ${profile.url} (profile ${profile.name})`);
process.exitCode = failed === 0 ? 0 : 1;

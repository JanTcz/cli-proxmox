// UC-4 — profiles (docs/features/01-read.md): a directory of files, chosen by flag, environment, the default file, else `default`;
// a token readable by others refused, a missing file named; the tier `read` unless the profile says more.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { configDir, loadProfile } from '../src/profile.ts';

const dir = mkdtempSync(join(tmpdir(), 'cli-proxmox-profile-'));
after(() => { rmSync(dir, { recursive: true, force: true }); });

function make(name: string, extra: Record<string, string> = {}, mode = 0o600): string {
  const at = join(dir, name);
  mkdirSync(at, { recursive: true });
  const files = { url: 'https://192.168.0.35:8006\n', 'ca.pem': 'PEM', 'token-id': 'cli@pve!lab\n', token: 'secret\n', ...extra };
  for (const [file, text] of Object.entries(files)) writeFileSync(join(at, file), text);
  chmodSync(join(at, 'token'), mode);
  return at;
}

test('UC-4: a profile\'s files, trimmed, and the tier read by default', () => {
  make('lab');
  assert.deepEqual(loadProfile(dir, 'lab'), { name: 'lab', url: 'https://192.168.0.35:8006', ca: 'PEM', tokenId: 'cli@pve!lab', secret: 'secret', tier: 'read' });
  make('only-tier', { 'profile.json': JSON.stringify({ tier: 'destructive' }) });
  assert.equal(loadProfile(dir, 'only-tier').tier, 'destructive');
  assert.equal('vmids' in loadProfile(dir, 'only-tier'), false);
  make('ops', { 'profile.json': JSON.stringify({ tier: 'write', vmids: [101, 102], pool: 'codiak' }) });
  assert.deepEqual(loadProfile(dir, 'ops'), { name: 'ops', url: 'https://192.168.0.35:8006', ca: 'PEM', tokenId: 'cli@pve!lab', secret: 'secret', tier: 'write', vmids: [101, 102], pool: 'codiak' });
});

test('UC-4: the name — given, else the environment, else the default file, else default', () => {
  make('default');
  make('env');
  make('chosen');
  assert.equal(loadProfile(dir, undefined, {}).name, 'default');
  writeFileSync(join(dir, 'default-profile'), 'chosen\n');
  assert.equal(loadProfile(dir, undefined, {}).name, 'chosen');
  assert.equal(loadProfile(dir, undefined, { PROXMOX_PROFILE: 'env' }).name, 'env');
  assert.equal(loadProfile(dir, 'lab', { PROXMOX_PROFILE: 'env' }).name, 'lab');
  rmSync(join(dir, 'default-profile'));
});

test('UC-4: the config directory — PROXMOX_CONFIG, else ~/.config/cli-proxmox', () => {
  assert.equal(configDir({ PROXMOX_CONFIG: '/etc/x' }), '/etc/x');
  assert.equal(configDir({}), join(homedir(), '.config', 'cli-proxmox'));
});

test('UC-4: a token readable by group or others, a missing file, an unknown profile and a bad profile.json are refused by name', () => {
  make('open', {}, 0o644);
  assert.throws(() => loadProfile(dir, 'open'), /profile open: its token .*token is readable by others \(644\); chmod 600 it/u);
  const at = make('partial');
  rmSync(join(at, 'ca.pem'));
  assert.throws(() => loadProfile(dir, 'partial'), /profile partial: no ca\.pem in /u);
  assert.throws(() => loadProfile(dir, 'nowhere'), /no profile nowhere in /u);
  for (const [name, json, said] of [['tier', { tier: 'root' }, /tier is read, write or destructive/u], ['ids', { vmids: ['101'] }, /vmids is a list of VM ids/u],
    ['pool', { pool: '' }, /pool names a pool/u], ['junk', '{', /profile\.json is not JSON/u]] as const) {
    make(`bad-${name}`, { 'profile.json': typeof json === 'string' ? json : JSON.stringify(json) });
    assert.throws(() => loadProfile(dir, `bad-${name}`), said, name);
  }
});

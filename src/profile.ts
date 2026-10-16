// Profiles (UC-4): a directory `<config>/<name>/` of files — `url`, `ca.pem`, `token-id`, `token` (readable by its owner only) and an
// optional `profile.json` (`tier`, `vmids`, `pool`). The name: given, else PROXMOX_PROFILE, else the file `<config>/default`, else
// `default`. The secret is read from its file only.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TIERS = ['read', 'write', 'destructive'] as const;
export type Tier = (typeof TIERS)[number];
export type Profile = { name: string; url: string; ca: string; tokenId: string; secret: string; tier: Tier; vmids?: number[]; pool?: string };
type Env = Readonly<Record<string, string | undefined>>;

export const configDir = (env: Env = process.env): string => env['PROXMOX_CONFIG'] ?? join(homedir(), '.config', 'cli-proxmox');

function nameOf(dir: string, given: string | undefined, env: Env): string {
  const chosen = given ?? env['PROXMOX_PROFILE'];
  if (chosen !== undefined) return chosen;
  const file = join(dir, 'default-profile');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : 'default';
}

function settingsOf(name: string, at: string): Pick<Profile, 'tier' | 'vmids' | 'pool'> {
  const file = join(at, 'profile.json');
  if (!existsSync(file)) return { tier: 'read' };
  let said: { tier?: unknown; vmids?: unknown; pool?: unknown };
  try {
    said = JSON.parse(readFileSync(file, 'utf8')) as typeof said;
  } catch {
    throw new Error(`profile ${name}: profile.json is not JSON`);
  }
  const { tier = 'read', vmids, pool } = said;
  if (!TIERS.includes(tier as Tier)) throw new Error(`profile ${name}: tier is read, write or destructive`);
  if (vmids !== undefined && !(Array.isArray(vmids) && vmids.every((id) => Number.isInteger(id)))) throw new Error(`profile ${name}: vmids is a list of VM ids`);
  if (pool !== undefined && !(typeof pool === 'string' && pool !== '')) throw new Error(`profile ${name}: pool names a pool`);
  return { tier: tier as Tier, ...(vmids === undefined ? {} : { vmids: vmids as number[] }), ...(pool === undefined ? {} : { pool: pool as string }) };
}

export function loadProfile(dir: string, given?: string, env: Env = process.env): Profile {
  const name = nameOf(dir, given, env);
  const at = join(dir, name);
  if (!existsSync(at)) throw new Error(`no profile ${name} in ${dir}`);
  const read = (file: string): string => {
    const path = join(at, file);
    if (!existsSync(path)) throw new Error(`profile ${name}: no ${file} in ${at}`);
    return readFileSync(path, 'utf8').trim();
  };
  const [url, ca, tokenId, secret] = [read('url'), read('ca.pem'), read('token-id'), read('token')];
  const token = join(at, 'token');
  // oxlint-disable-next-line no-bitwise -- a file's mode is bits
  const mode = statSync(token).mode & 0o777;
  // oxlint-disable-next-line no-bitwise -- the group's and others' bits
  if ((mode & 0o077) !== 0) throw new Error(`profile ${name}: its token ${token} is readable by others (${mode.toString(8)}); chmod 600 it`);
  return { name, url, ca, tokenId, secret, ...settingsOf(name, at) };
}

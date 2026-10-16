// The operations (UC-5, UC-6): the one catalog the CLI and its MCP twin are made from. Each names its words, its arguments and flags,
// its tier and what it does; its run reads Proxmox through the typed client and answers lines for a person or a model and the whole
// answer as JSON. Slice 1 reads only.
import type { Pve } from './api/client.ts';
import { gib, percent, table, uptime, utc } from './format.ts';
import { fenceOf, inScope } from './policy.ts';
import type { Profile, Tier } from './profile.ts';

export type Ctx = { pve: Pve; profile: Profile };
export type Input = { args: Readonly<Record<string, string>>; flags: Readonly<Record<string, string>> };
export type Answer = { json: unknown; lines: string[] };
export type Operation = {
  words: string; args: readonly string[]; flags: readonly string[]; tier: Tier; summary: string;
  run: (ctx: Ctx, input: Input) => Promise<Answer>;
};

// A command's input that is not what it takes: the CLI says it with the command's usage, exit 2.
export class UsageError extends Error {}

const vmidOf = (text: string): number => {
  if (!/^\d+$/u.test(text)) throw new UsageError(`vmid is a whole number, not ${text}`);
  return Number(text);
};

type Guest = Awaited<ReturnType<Pve['cluster']['resources']['$get']>>[number];

// The guests the profile may see, by VM id.
async function guests({ pve, profile }: Ctx): Promise<Guest[]> {
  const all = await pve.cluster.resources.$get({ type: 'vm' });
  return all.filter((guest) => inScope({ vmid: guest.vmid!, ...(guest.pool === undefined ? {} : { pool: guest.pool }) }, profile))
    .toSorted((a, b) => a.vmid! - b.vmid!);
}

// One guest in scope, or a refusal by name before anything of it is read.
async function oneGuest(ctx: Ctx, text: string): Promise<Guest> {
  const vmid = vmidOf(text);
  const found = (await ctx.pve.cluster.resources.$get({ type: 'vm' })).find((one) => one.vmid === vmid);
  if (!found) throw new Error(`no VM ${vmid}`);
  if (!inScope({ vmid, ...(found.pool === undefined ? {} : { pool: found.pool }) }, ctx.profile)) {
    throw new Error(`VM ${vmid} is outside the profile ${ctx.profile.name} (${fenceOf(ctx.profile)})`);
  }
  if (found.type !== 'qemu') throw new Error(`VM ${vmid} is a ${found.type ?? 'guest'}: only QEMU VMs are shown`);
  return found;
}

async function nodes(pve: Pve): Promise<string[]> {
  return (await pve.nodes.$get()).map((node) => node.node).toSorted();
}

const vmLs: Operation = {
  words: 'vm ls', args: [], flags: [], tier: 'read', summary: 'the guests the profile may see: id, name, status, node, cpu, memory, uptime',
  async run(ctx) {
    const listed = await guests(ctx);
    const rows = listed.map((g) => [String(g.vmid), g.name ?? '-', g.type ?? '-', g.status ?? '-', g.node ?? '-', percent(g.cpu),
      `${(g.mem! / 1024 ** 3).toFixed(1)}/${gib(g.maxmem)}`, uptime(g.uptime)]);
    return { json: listed, lines: table([['VMID', 'NAME', 'TYPE', 'STATUS', 'NODE', 'CPU', 'MEM', 'UPTIME'], ...rows]) };
  },
};

const vmShow: Operation = {
  words: 'vm show', args: ['vmid'], flags: [], tier: 'read', summary: 'one VM: its status with QEMU\'s own state (an I/O error is not "running") and its config',
  async run(ctx, { args }) {
    const found = await oneGuest(ctx, args['vmid']!);
    const at = ctx.pve.nodes.$(found.node!).qemu.$(found.vmid!);
    const status = await at.status.current.$get();
    const config = await at.config.$get();
    const lines = [
      `${found.vmid} ${found.name ?? '-'} on ${found.node}: ${status.status}, QEMU ${status.qmpstatus ?? 'unknown'}`,
      `cpu ${percent(status.cpu)} of ${status.cpus ?? '-'}, memory ${(status.mem! / 1024 ** 3).toFixed(1)}/${gib(status.maxmem)}, uptime ${uptime(status.uptime)}`,
      'config:',
      ...Object.entries(config).toSorted(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `  ${key}: ${String(value)}`),
    ];
    return { json: { guest: found, status, config }, lines };
  },
};

const storageLs: Operation = {
  words: 'storage ls', args: [], flags: [], tier: 'read', summary: 'each node\'s storages: type, used and total space, use, content',
  async run({ pve }) {
    const listed = (await Promise.all((await nodes(pve)).map(async (node) => (await pve.nodes.$(node).storage.$get()).map((one) => Object.assign({ node }, one))))).flat();
    const rows = listed.map((s) => [s.node, s.storage, s.type, gib(s.used), gib(s.total), percent(s.used_fraction), s.content]);
    return { json: listed, lines: table([['NODE', 'STORAGE', 'TYPE', 'USED', 'TOTAL', 'USE%', 'CONTENT'], ...rows]) };
  },
};

const thinLs: Operation = {
  words: 'thin ls', args: [], flags: ['warn'], tier: 'read',
  summary: 'each LVM-thin pool\'s data and metadata use, flagged over --warn percent (80): a full pool pauses its guests',
  async run({ pve }, { flags }) {
    const warn = flags['warn'] === undefined ? 80 : Number(flags['warn']);
    if (!(Number.isInteger(warn) && warn >= 1 && warn <= 100)) throw new UsageError(`warn is a percent, 1 to 100, not ${flags['warn']}`);
    const pools = (await Promise.all((await nodes(pve)).map(async (node) => (await pve.nodes.$(node).disks.lvmthin.$get()).map((pool) => {
      const data = (pool.used / pool.lv_size) * 100;
      const metadata = (pool.metadata_used / pool.metadata_size) * 100;
      return { node, vg: pool.vg, lv: pool.lv, data, metadata, over: data > warn || metadata > warn };
    })))).flat();
    const rows = pools.map((p) => [p.node, p.vg, p.lv, `${p.data.toFixed(1)}%`, `${p.metadata.toFixed(1)}%`, ...(p.over ? [`over ${warn}%`] : [])]);
    return { json: pools, lines: table([['NODE', 'VG', 'LV', 'DATA', 'META'], ...rows]) };
  },
};

const UPID = /^UPID:([^:]+):/u;
const taskShow: Operation = {
  words: 'task show', args: ['upid'], flags: [], tier: 'read', summary: 'a task by its UPID: what, by whom, its status and exit status, when it started',
  async run({ pve }, { args }) {
    const upid = args['upid']!;
    const node = UPID.exec(upid)?.[1];
    if (node === undefined) throw new UsageError(`upid is a task id, UPID:<node>:…, not ${upid}`);
    const task = await pve.nodes.$(node).tasks.$(upid).status.$get();
    const what = task.id ? `${task.type} ${task.id}` : task.type;
    const ended = task.exitstatus === undefined ? '' : `, ${task.exitstatus}`;
    return { json: task, lines: [upid, `${what} by ${task.user} on ${task.node}: ${task.status}${ended}`, `started ${utc(task.starttime)}`] };
  },
};

const nextId: Operation = {
  words: 'next-id', args: [], flags: [], tier: 'read', summary: 'the next free VM id of the cluster',
  async run({ pve }) {
    const id = String(await pve.cluster.nextid.$get());
    return { json: id, lines: [id] };
  },
};

export const OPERATIONS: readonly Operation[] = [vmLs, vmShow, storageLs, thinLs, taskShow, nextId];

// How a command is called: its words, `<arg>` for each argument, `[--flag <flag>]` for each flag.
export const usageOf = ({ words, args, flags }: Operation): string =>
  [words, ...args.map((arg) => `<${arg}>`), ...flags.map((flag) => `[--${flag} <${flag}>]`)].join(' ');

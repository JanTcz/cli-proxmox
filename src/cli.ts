// The command line (UC-6): `proxmox [--profile <name>] [--json] <words> <args> [--<flag> <value>]`. The words choose an operation of
// the catalog; its tier is checked against the profile before any request; its answer is lines, or JSON with --json. Usage on an
// unknown command or a missing argument, exit 2; a failure, one line `proxmox: …` and exit 1.
import type { Pve } from './api/client.ts';
import { type Operation, OPERATIONS, UsageError, usageOf } from './catalog.ts';
import { refusal } from './policy.ts';
import type { Profile } from './profile.ts';

export type Io = { out: (line: string) => void; err: (line: string) => void };
export type Opened = { pve: Pve; profile: Profile };
// What opens a profile by its name (none: the default): its client and what it allows.
export type Open = (name: string | undefined) => Opened;

const USAGE = 'usage: proxmox [--profile <name>] [--json] <command>';

export function help(): string[] {
  const width = Math.max(...OPERATIONS.map((op) => usageOf(op).length));
  return [USAGE, '', 'commands:', ...OPERATIONS.map((op) => `  ${usageOf(op).padEnd(width)}  ${op.tier.padEnd(11)}  ${op.summary}`),
    '', 'proxmox mcp  serves these commands as MCP tools over stdio'];
}

type Parsed = { op: Operation; profile: string | undefined; json: boolean; args: Record<string, string>; flags: Record<string, string> };

// The words, then the operation's arguments in order and its flags; --profile and --json anywhere.
function parse(argv: readonly string[], operations: readonly Operation[]): Parsed | 'help' {
  const rest: string[] = [];
  let profile: string | undefined;
  let json = false;
  for (let at = 0; at < argv.length; at++) {
    const word = argv[at]!;
    if (word === '--help' || word === '-h') return 'help';
    if (word === '--json') json = true;
    else if (word === '--profile') profile = argv[++at];
    else rest.push(word);
  }
  const op = operations.find(({ words }) => words.split(' ').every((part, i) => rest[i] === part));
  if (!op) throw new UsageError(rest.length === 0 ? 'no command given' : `no command ${rest.join(' ')}`);
  const given = rest.slice(op.words.split(' ').length);
  const args: Record<string, string> = {};
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let at = 0; at < given.length; at++) {
    const word = given[at]!;
    if (word.startsWith('--')) {
      const name = word.slice(2);
      const value = given[++at];
      if (!op.flags.includes(name)) throw new UsageError(`${op.words} takes no --${name}`, { cause: op });
      if (value === undefined) throw new UsageError(`--${name} needs a value`, { cause: op });
      flags[name] = value;
    } else positional.push(word);
  }
  if (positional.length !== op.args.length) throw new UsageError(`${op.words} takes ${op.args.map((arg) => `<${arg}>`).join(' ') || 'no argument'}`, { cause: op });
  op.args.forEach((arg, i) => { args[arg] = positional[i]!; });
  return { op, profile, json, args, flags };
}

// The catalog is OPERATIONS; a test may give its own.
export async function run(argv: readonly string[], io: Io, open: Open, operations: readonly Operation[] = OPERATIONS): Promise<number> {
  let parsed: Parsed | 'help' | undefined;
  try {
    parsed = parse(argv, operations);
    if (parsed === 'help') {
      for (const line of help()) io.out(line);
      return 0;
    }
    const { op, json, args, flags } = parsed;
    const ctx = open(parsed.profile);
    const refused = refusal(op.tier, ctx.profile);
    if (refused !== undefined) throw new Error(refused);
    const answer = await op.run(ctx, { args, flags });
    for (const line of json ? JSON.stringify(answer.json, null, 2).split('\n') : answer.lines) io.out(line);
    return 0;
  } catch (error) {
    io.err(`proxmox: ${(error as Error).message}`);
    if (!(error instanceof UsageError)) return 1;
    const op = (error.cause as Operation | undefined) ?? (typeof parsed === 'object' ? parsed.op : undefined);
    io.err(op === undefined ? USAGE : `usage: proxmox ${usageOf(op)}`);
    return 2;
  }
}

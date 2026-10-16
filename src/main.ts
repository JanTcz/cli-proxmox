// The composition root: `proxmox <command>` and `proxmox mcp` — a profile opened from its files, its client on Proxmox's HTTPS API.
// Proven by `npm run contract` against a real host, not by the unit tests.
import { createInterface } from 'node:readline';
import packageJson from '../package.json' with { type: 'json' };
import { api } from './api/client.ts';
import { OPERATIONS } from './catalog.ts';
import { type Io, type Opened, run } from './cli.ts';
import { mcpServer } from './mcp.ts';
import { configDir, loadProfile } from './profile.ts';
import { transport } from './transport.ts';

const TIMEOUT_MS = 30_000;

const open = (name: string | undefined): Opened => {
  const profile = loadProfile(configDir(), name);
  return { profile, pve: api(transport({ url: profile.url, ca: profile.ca, tokenId: profile.tokenId, secret: profile.secret, timeoutMs: TIMEOUT_MS })) };
};
const io: Io = { out: (line) => { process.stdout.write(`${line}\n`); }, err: (line) => { process.stderr.write(`${line}\n`); } };
const argv = process.argv.slice(2);

if (argv[0] === 'mcp' && argv.length === 1) {
  const handle = mcpServer(OPERATIONS, (words, said) => run(words, said, open), packageJson.version);
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const answer = await handle(line);
    if (answer !== undefined) process.stdout.write(`${answer}\n`);
  }
} else {
  process.exitCode = await run(argv, io, open);
}

// `proxmox mcp` (UC-7): the catalog as MCP tools over stdio — newline-delimited JSON-RPC 2.0, by hand, as codiak's CLI serves its
// own. One tool a command (`vm_show` for `vm show`), its arguments and flags as string properties, `json` and `profile` beside them,
// the hints from its tier; each call runs the CLI itself with those words, so a tool answers nothing the CLI would not.
import type { Io } from './cli.ts';
import { type Operation, usageOf } from './catalog.ts';

export type Cli = (argv: string[], io: Io) => Promise<number>;
type Message = { id?: number | string | null; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> } };

const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];
export const toolName = (words: string): string => words.replaceAll(/[ -]/gu, '_');

function toolOf(op: Operation) {
  return {
    name: toolName(op.words), description: op.summary,
    inputSchema: { type: 'object', additionalProperties: false, required: [...op.args], properties: {
      ...Object.fromEntries([...op.args, ...op.flags].map((name) => [name, { type: 'string' }])),
      json: { type: 'boolean', description: 'the whole answer as JSON' }, profile: { type: 'string', description: 'the profile to use' } } },
    annotations: { title: usageOf(op), readOnlyHint: op.tier === 'read', destructiveHint: op.tier === 'destructive', openWorldHint: false },
  };
}

// A call's arguments as the CLI's argv, or what is wrong with them.
function argvOf(op: Operation, given: Record<string, unknown>): string[] {
  const name = toolName(op.words);
  for (const [key, value] of Object.entries(given)) {
    if (key === 'json') {
      if (typeof value !== 'boolean') throw new TypeError(`${name}: json is a boolean`);
    } else if (![...op.args, ...op.flags, 'profile'].includes(key)) throw new TypeError(`${name}: no argument ${key}`);
    else if (typeof value !== 'string') throw new TypeError(`${name}: ${key} is a string`);
  }
  const missing = op.args.find((arg) => given[arg] === undefined);
  if (missing !== undefined) throw new TypeError(`${name}: ${missing} is required`);
  const text = given as Record<string, string>;
  return [...(text['profile'] === undefined ? [] : ['--profile', text['profile']]), ...op.words.split(' '), ...op.args.map((arg) => text[arg]!),
    ...op.flags.flatMap((flag) => (text[flag] === undefined ? [] : [`--${flag}`, text[flag]])), ...(given['json'] === true ? ['--json'] : [])];
}

const answer = (id: Message['id'], result: unknown): string => JSON.stringify({ jsonrpc: '2.0', id, result });
const fault = (id: Message['id'], code: number, message: string): string => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
// What a notification and an empty line are answered with: nothing.
const SILENCE: Promise<string | undefined> = Promise.resolve(void 0);

export function mcpServer(operations: readonly Operation[], cli: Cli, version: string): (line: string) => Promise<string | undefined> {

  async function call(id: Message['id'], params: Message['params']): Promise<string> {
    const op = operations.find((one) => toolName(one.words) === params?.name);
    if (!op) return fault(id, -32_602, `no tool ${params?.name}`);
    let argv: string[];
    try {
      argv = argvOf(op, params?.arguments ?? {});
    } catch (error) {
      return fault(id, -32_602, (error as Error).message);
    }
    const said: string[] = [];
    const code = await cli(argv, { out: (line) => said.push(line), err: (line) => said.push(line) });
    return answer(id, { content: [{ type: 'text', text: said.join('\n') }], isError: code !== 0 });
  }

  return (line) => {
    if (line.trim() === '') return SILENCE;
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      return Promise.resolve(fault(null, -32_700, 'not JSON'));
    }
    const { id, method, params } = message;
    if (id === undefined) return SILENCE;
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        return Promise.resolve(answer(id, { protocolVersion: PROTOCOLS.includes(asked!) ? asked : PROTOCOLS.at(-1), capabilities: { tools: {} }, serverInfo: { name: 'proxmox', version } }));
      }
      case 'ping': return Promise.resolve(answer(id, {}));
      case 'tools/list': return Promise.resolve(answer(id, { tools: operations.map((op) => toolOf(op)) }));
      case 'tools/call': return call(id, params);
      default: return Promise.resolve(fault(id, -32_601, `no method ${method}`));
    }
  };
}

// UC-7 — the MCP twin (docs/features/01-read.md): the catalog over stdio, one tool a command, each call run through the CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpServer, toolName } from '../src/mcp.ts';
import { OPERATIONS } from '../src/catalog.ts';

type Ran = { argv: string[] };
function server(answer: (argv: string[]) => { code: number; out?: string[]; err?: string[] } = () => ({ code: 0, out: ['105'] })) {
  const ran: Ran[] = [];
  const handle = mcpServer(OPERATIONS, async (argv, io) => {
    ran.push({ argv });
    const said = answer(argv);
    for (const line of said.out ?? []) io.out(line);
    for (const line of said.err ?? []) io.err(line);
    return said.code;
  }, '0.1.0');
  const ask = async (message: object) => {
    const line = await handle(JSON.stringify({ jsonrpc: '2.0', ...message }));
    return line === undefined ? undefined : JSON.parse(line) as { id?: number; result?: any; error?: { code: number; message: string } };
  };
  return { ask, ran, handle };
}

test('UC-7: initialize names the server and the tools capability, in the protocol the client asked for when it is known', async () => {
  const { ask } = server();
  const init = await ask({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.deepEqual(init, { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'proxmox', version: '0.1.0' } } });
  const other = await ask({ id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(other?.result.protocolVersion, '2025-06-18', 'an unknown version: the newest the server speaks');
  assert.equal(await ask({ method: 'notifications/initialized' }), undefined, 'a notification is not answered');
  assert.deepEqual(await ask({ id: 3, method: 'ping' }), { jsonrpc: '2.0', id: 3, result: {} });
});

test('UC-7: tools/list — one tool a command, its arguments and flags as properties, the hints from its tier', async () => {
  const { ask } = server();
  const { result } = (await ask({ id: 1, method: 'tools/list' }))!;
  const tools = result.tools as { name: string; description: string; inputSchema: any; annotations: any }[];
  assert.deepEqual(tools.map((t) => t.name), OPERATIONS.map((op) => toolName(op.words)));
  const show = tools.find((t) => t.name === 'vm_show')!;
  assert.deepEqual(show.inputSchema, { type: 'object', additionalProperties: false, required: ['vmid'], properties: {
    vmid: { type: 'string' }, json: { type: 'boolean', description: 'the whole answer as JSON' }, profile: { type: 'string', description: 'the profile to use' } } });
  assert.deepEqual(show.annotations, { title: 'vm show <vmid>', readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  const thin = tools.find((t) => t.name === 'thin_ls')!;
  assert.deepEqual(thin.inputSchema.required, []);
  assert.deepEqual(thin.inputSchema.properties.warn, { type: 'string' });
});

test('UC-7: tools/call runs the CLI with the tool\'s words, arguments, flags, json and profile; its output is the answer', async () => {
  const { ask, ran } = server(() => ({ code: 0, out: ['line one', 'line two'] }));
  const answer = await ask({ id: 5, method: 'tools/call', params: { name: 'thin_ls', arguments: { warn: '70', json: true, profile: 'lab' } } });
  assert.deepEqual(ran, [{ argv: ['--profile', 'lab', 'thin', 'ls', '--warn', '70', '--json'] }]);
  assert.deepEqual(answer?.result, { content: [{ type: 'text', text: 'line one\nline two' }], isError: false });
  await ask({ id: 6, method: 'tools/call', params: { name: 'vm_show', arguments: { vmid: '101' } } });
  assert.deepEqual(ran[1], { argv: ['vm', 'show', '101'] });
});

test('UC-7: a CLI that exits non-zero is an error result with what it said; a bad call is refused', async () => {
  const { ask } = server(() => ({ code: 1, err: ['proxmox: VM 200 is outside the profile lab (pool codiak)'] }));
  const failed = await ask({ id: 1, method: 'tools/call', params: { name: 'vm_show', arguments: { vmid: '200' } } });
  assert.deepEqual(failed?.result, { content: [{ type: 'text', text: 'proxmox: VM 200 is outside the profile lab (pool codiak)' }], isError: true });
  const unknown = await ask({ id: 2, method: 'tools/call', params: { name: 'vm_eat', arguments: {} } });
  assert.deepEqual(unknown?.error, { code: -32602, message: 'no tool vm_eat' });
  const missing = await ask({ id: 3, method: 'tools/call', params: { name: 'vm_show' } });
  assert.deepEqual(missing?.error, { code: -32602, message: 'vm_show: vmid is required' });
  const wrongType = await ask({ id: 4, method: 'tools/call', params: { name: 'vm_show', arguments: { vmid: 101 } } });
  assert.deepEqual(wrongType?.error, { code: -32602, message: 'vm_show: vmid is a string' });
  const extra = await ask({ id: 5, method: 'tools/call', params: { name: 'next_id', arguments: { colour: 'red' } } });
  assert.deepEqual(extra?.error, { code: -32602, message: 'next_id: no argument colour' });
});

test('UC-7: an unknown method is -32601, a line that is not JSON-RPC is -32700, an empty line nothing', async () => {
  const { ask, handle } = server();
  assert.deepEqual((await ask({ id: 9, method: 'resources/list' }))?.error, { code: -32601, message: 'no method resources/list' });
  assert.deepEqual(JSON.parse((await handle('{nope'))!), { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } });
  assert.equal(await handle('   '), undefined);
});

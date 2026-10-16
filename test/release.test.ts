// The release (docs/DESIGN.md, the plugin in agents/): one version everywhere — package.json, both plugin manifests and what the MCP
// server says; the plugin runs the published package's `mcp`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '../src/version.ts';

const ROOT = join(import.meta.dirname, '..');
const json = (file: string) => JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as Record<string, any>;

test('one version: package.json, both plugin manifests, the server', () => {
  const pkg = json('package.json');
  assert.equal(VERSION, pkg['version']);
  for (const manifest of ['agents/.claude-plugin/plugin.json', 'agents/.codex-plugin/plugin.json']) {
    assert.equal(json(manifest)['version'], pkg['version'], manifest);
    assert.equal(json(manifest)['name'], pkg['name'], manifest);
  }
});

test('the plugin runs the published package\'s MCP server at its major version; the repository runs its own sources', () => {
  const major = String(json('package.json')['version']).split('.')[0];
  assert.deepEqual(json('agents/.mcp.json')['mcpServers'].proxmox, { command: 'npx', args: ['-y', `cli-proxmox@${major}`, 'mcp'] });
  assert.deepEqual(json('.mcp.json')['mcpServers'].proxmox.args, ['bin/proxmox.ts', 'mcp']);
  assert.equal(json('package.json')['bin'].proxmox, 'dist/bin/proxmox.js');
});

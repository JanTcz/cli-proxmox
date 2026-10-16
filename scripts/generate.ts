// npm run generate: the typed client (src/api/pve.gen.ts) from the vendored schema, refused when the schema is not the one recorded.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate, type SchemaNode, SCHEMA_SHA256, SCHEMA_VERSION } from '../src/api/generate.ts';

const root = join(import.meta.dirname, '..');
const raw = readFileSync(join(root, 'schema', `pve-${SCHEMA_VERSION}.json`));
const sum = createHash('sha256').update(raw).digest('hex');
if (sum !== SCHEMA_SHA256) throw new Error(`schema/pve-${SCHEMA_VERSION}.json is ${sum}, not the recorded ${SCHEMA_SHA256}`);
writeFileSync(join(root, 'src', 'api', 'pve.gen.ts'), generate(JSON.parse(raw.toString('utf8')) as SchemaNode[], SCHEMA_VERSION));

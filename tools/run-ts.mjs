#!/usr/bin/env node
/**
 * Runs a TypeScript file from the project in node (bundled with rolldown first): for quick
 * measurement scripts during modelling, e.g. `node tools/run-ts.mjs path/to/script.ts`.
 */
import { build } from 'rolldown';
import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(process.argv[2]);
const out = await build({ input: entry, platform: 'node', write: false, output: { format: 'esm' }, logLevel: 'silent', transform: { define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false' } } });
const dir = join(root, 'tools/out/run-ts');
mkdirSync(dir, { recursive: true });
const file = join(dir, basename(entry).replace(/\.ts$/, '.mjs'));
writeFileSync(file, out.output[0].code);
await import(pathToFileURL(file).href);

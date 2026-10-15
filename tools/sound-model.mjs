#!/usr/bin/env node
/**
 * Fits procedural sound models to reference recordings (docs/audio.md, "Cloning a recording").
 * Bundles tools/soundModelCli.ts for Node with rolldown and runs it with the same arguments.
 * Recordings must be 16-bit PCM WAV (convert with ffmpeg first).
 *
 *   node tools/sound-model.mjs <onsets|print|texture> --in recording.wav …
 */
import { build } from 'rolldown';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const out = path.join(os.tmpdir(), `dyson-sound-model-${process.pid}.mjs`);
const bundle = await build({ input: 'tools/soundModelCli.ts', platform: 'node', write: false, output: { format: 'esm' }, logLevel: 'warn' });
fs.writeFileSync(out, bundle.output[0].code);
try {
  const { run } = await import(pathToFileURL(out).href);
  run({
    args: process.argv.slice(2),
    read: (p) => new Uint8Array(fs.readFileSync(p)),
    write: (p, data) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data);
    },
    log: (line) => console.log(line),
  });
} finally {
  fs.rmSync(out, { force: true });
}

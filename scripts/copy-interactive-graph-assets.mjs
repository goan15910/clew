#!/usr/bin/env node
// Copy vendored Cytoscape UMD builds and the browser mount into dist/ for npm pack.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fromDir = join(root, 'src', 'adapters', 'diagram', 'interactive');
const toDir = join(root, 'dist', 'adapters', 'diagram', 'interactive');

const vendorFrom = join(fromDir, 'vendor');
const vendorTo = join(toDir, 'vendor');
const clientFrom = join(fromDir, 'client');
const clientTo = join(toDir, 'client');

if (!existsSync(vendorFrom)) {
  console.error(`missing vendor dir: ${vendorFrom}`);
  process.exit(1);
}
mkdirSync(vendorTo, { recursive: true });
mkdirSync(clientTo, { recursive: true });
cpSync(vendorFrom, vendorTo, { recursive: true });
cpSync(clientFrom, clientTo, { recursive: true });
console.log('copied interactive graph assets into dist/');

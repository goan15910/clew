// Runs dependency-cruiser against src unless arguments say otherwise.
// Plants under tests/architecture pass their own arguments.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const reader = join(root, 'node_modules/cruiser-typescript/node_modules/typescript');
const destDir = join(root, 'node_modules/dependency-cruiser/node_modules');
const dest = join(destDir, 'typescript');

function version(packageJson) {
  return JSON.parse(readFileSync(packageJson, 'utf8')).version;
}

// dependency-cruiser loads `typescript` from its own folder. TypeScript 7,
// which Clew compiles with, does not expose the compiler API it needs.
// TypeScript 6 stays nested under cruiser-typescript and is linked here.
const wanted = version(join(reader, 'package.json'));
let linked;
try {
  linked = version(join(dest, 'package.json'));
} catch {
  linked = undefined;
}
if (linked !== wanted) {
  mkdirSync(destDir, { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  symlinkSync(relative(destDir, reader), dest);
}

const args =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['--config', join(root, '.dependency-cruiser.cjs'), '--output-type', 'err', 'src'];

const result = spawnSync(join(root, 'node_modules/.bin/depcruise'), args, {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);

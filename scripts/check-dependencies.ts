// Fails when src imports point the wrong way: adapters → application → domain.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

type Layer = 'domain' | 'application' | 'adapters' | 'cli';

const LAYER_ROOTS: Record<Exclude<Layer, 'cli'>, string> = {
  domain: 'src/domain/',
  application: 'src/application/',
  adapters: 'src/adapters/',
};

function slash(path: string): string {
  return path.split(sep).join('/');
}

function layerOf(file: string): Layer | undefined {
  if (file === 'src/cli.ts') return 'cli';
  if (file.startsWith(LAYER_ROOTS.domain)) return 'domain';
  if (file.startsWith(LAYER_ROOTS.application)) return 'application';
  if (file.startsWith(LAYER_ROOTS.adapters)) return 'adapters';
  return undefined;
}

function stripComments(source: string): string {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      out += char;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          out += source[index] + (source[index + 1] ?? '');
          index += 2;
          continue;
        }
        out += source[index];
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function specifiers(source: string): string[] {
  const text = stripComments(source);
  const found: string[] = [];
  // Only real import/export statements. A path key named `from` is not an import.
  for (const match of text.matchAll(/(?:^|[;\n])\s*(import|export)\b([\s\S]*?);/g)) {
    const kind = match[1];
    const body = match[2] ?? '';
    const from = body.match(/\bfrom\s*['"]([^'"]+)['"]/);
    if (from?.[1] !== undefined) {
      found.push(from[1]);
      continue;
    }
    if (kind === 'import') {
      const sideEffect = body.match(/^\s*(?:type\s+)?['"]([^'"]+)['"]/);
      if (sideEffect?.[1] !== undefined) found.push(sideEffect[1]);
    }
  }
  for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  for (const match of text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
}

function resolveRelative(fromFile: string, spec: string): string {
  const raw = slash(normalize(join(dirname(fromFile), spec)));
  if (raw.endsWith('.js')) return `${raw.slice(0, -3)}.ts`;
  return raw;
}

function allowsRelative(layer: Layer, target: string): boolean {
  if (layer === 'domain') return target.startsWith(LAYER_ROOTS.domain);
  if (layer === 'application') return target.startsWith(LAYER_ROOTS.domain) || target.startsWith(LAYER_ROOTS.application);
  if (layer === 'adapters') {
    return target.startsWith(LAYER_ROOTS.domain) || target.startsWith(LAYER_ROOTS.application) || target.startsWith(LAYER_ROOTS.adapters);
  }
  return target.startsWith('src/');
}

function allowsPackage(layer: Layer, spec: string): boolean {
  if (layer === 'domain') return false;
  if (layer === 'application') return spec === 'node:path';
  if (layer === 'cli') return spec === 'zod' || spec === 'commander' || spec === '@commander-js/extra-typings';
  return true;
}

export function checkFile(file: string, source: string): string[] {
  const layer = layerOf(file);
  if (layer === undefined) {
    if (file.startsWith('src/')) return [`${file} sits outside domain/, application/, adapters/, and cli.ts`];
    return [];
  }
  const errors: string[] = [];
  for (const spec of specifiers(source)) {
    if (spec.startsWith('.')) {
      const target = resolveRelative(file, spec);
      if (!allowsRelative(layer, target)) {
        errors.push(`${file}: import '${spec}' points out of the ${layer} layer (${target})`);
      }
      continue;
    }
    if (!allowsPackage(layer, spec)) {
      errors.push(`${file}: import '${spec}' is not allowed in the ${layer} layer`);
    }
  }
  return errors;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function expectErrors(file: string, source: string, needle: string): void {
  const errors = checkFile(file, source);
  if (!errors.some((error) => error.includes(needle))) {
    throw new Error(`expected ${file} to mention ${needle}, got ${errors.join('; ') || '(none)'}`);
  }
}

function expectClean(file: string, source: string): void {
  const errors = checkFile(file, source);
  if (errors.length > 0) throw new Error(`expected ${file} to pass: ${errors.join('; ')}`);
}

function selfTest(): void {
  expectErrors('src/domain/model.ts', `import { x } from '../application/ports.js';\n`, 'application/ports.ts');
  expectErrors('src/domain/model.ts', `import { createMachine } from 'xstate';\n`, 'xstate');
  expectErrors('src/domain/model.ts', `export async function load(): Promise<void> {\n  await import('xstate');\n}\n`, 'xstate');
  expectErrors('src/application/verify-model.ts', `const yaml = require('yaml');\n`, 'yaml');
  expectErrors('src/domain/model.ts', `import { readFileSync } from 'node:fs';\n`, 'node:fs');
  expectErrors('src/domain/model.ts', `import { z } from 'zod';\n`, 'zod');
  expectErrors('src/domain/model.ts', `import { parse } from 'yaml';\n`, 'yaml');
  expectErrors('src/application/verify-model.ts', `import { load } from '../adapters/yaml/model-loader.js';\n`, 'adapters/yaml/model-loader.ts');
  expectErrors('src/application/verify-model.ts', `import { readFileSync } from 'node:fs';\n`, 'node:fs');
  expectErrors('src/cli.ts', `import { readFileSync } from 'node:fs';\n`, 'node:fs');
  expectErrors('src/contract.ts', `export const leftover = 1;\n`, 'outside');
  expectClean('src/domain/model.ts', `import type { Workflow } from './workflow.js';\n`);
  expectClean('src/domain/model.ts', `export function f(): void {\n  const path = ['transitions', 0, 'from'];\n  const message = \`unknown source state "\${id}"\`;\n}\n`);
  expectClean('src/domain/model.ts', `// import { createMachine } from 'xstate';\nexport const name = 'model';\n`);
  expectClean('src/application/candidate-name.ts', `import { basename } from 'node:path';\n`);
  expectClean('src/adapters/xstate/traversal-engine.ts', `import { createMachine } from 'xstate';\n`);
  expectClean('src/adapters/yaml/model-loader.ts', `import { assembleModel } from '../../domain/model.js';\n`);
  expectClean('src/cli.ts', `import { z } from 'zod';\n`);
}

function scan(): string[] {
  const errors: string[] = [];
  for (const full of walk(join(ROOT, 'src'))) {
    const file = slash(relative(ROOT, full));
    errors.push(...checkFile(file, readFileSync(full, 'utf8')));
  }
  return errors;
}

selfTest();
const errors = scan();
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

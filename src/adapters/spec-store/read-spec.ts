// Read a Markdown spec from a file. Clew never reads stdin.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SpecTextSource } from '../../application/ports.js';

export function sha256Prefixed(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

export const specTextSource: SpecTextSource = {
  read(file) {
    if (file === '-') return { ok: false, message: 'Clew does not read stdin; pass a Markdown spec file' };
    try {
      const text = readFileSync(file, 'utf8');
      return { ok: true, spec: { text, path: resolve(file), hash: sha256Prefixed(text) } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `cannot read ${file}: ${message}` };
    }
  },
  hash: sha256Prefixed,
};

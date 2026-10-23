import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { readJson } from '../json/read-json.js';

const PackageJson = z.object({ version: z.string().min(1) });

// src/adapters/package and dist/adapters/package are both three levels below the installed package.json.
export function packageVersion(): { ok: true; version: string } | { ok: false; error: string } {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json');
  const read = readJson(file);
  if (!read.ok) return read;
  const parsed = PackageJson.safeParse(read.value);
  if (!parsed.success) return { ok: false, error: `package.json has no version: ${file}` };
  return { ok: true, version: parsed.data.version };
}

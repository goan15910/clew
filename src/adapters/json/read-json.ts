import { readFileSync } from 'node:fs';

export function readJson(file: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `cannot read ${file}: ${message}` };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `invalid JSON in ${file}: ${message}` };
  }
}

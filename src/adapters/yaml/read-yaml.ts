import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export function readYaml(file: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `cannot read ${file}: ${message}` };
  }
  try {
    return { ok: true, value: parse(text) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `invalid YAML in ${file}: ${message}` };
  }
}

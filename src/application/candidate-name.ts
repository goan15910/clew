import { basename } from 'node:path';

/** Candidate name used in reports. `todo/b-full.yaml` and `b-full.json` are both `b-full`. */
export function candidateName(file: string): string {
  return basename(file).replace(/\.(ya?ml|json)$/, '');
}

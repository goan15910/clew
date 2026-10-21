import { basename } from 'node:path';

/** Candidate name used in reports. `todo/b-full.yaml` is `b-full`. */
export function candidateName(file: string): string {
  return basename(file).replace(/\.ya?ml$/, '');
}

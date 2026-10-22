// Per-user spec store location. Nothing here is inside the repo.
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export function clewDataDir(env: NodeJS.ProcessEnv, platform: string, home: string): string {
  const override = env.CLEW_DATA_DIR;
  if (override !== undefined && override !== '') return override;
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA !== undefined && env.LOCALAPPDATA !== ''
      ? env.LOCALAPPDATA
      : join(home, 'AppData', 'Local');
    return join(base, 'clew');
  }
  const base = env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME !== ''
    ? env.XDG_DATA_HOME
    : join(home, '.local', 'share');
  return join(base, 'clew');
}

export function findProjectRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function projectKey(root: string): string {
  const real = realpathSync(root);
  const name = basename(real).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';
  const hash = createHash('sha256').update(real).digest('hex').slice(0, 12);
  return `${name}-${hash}`;
}

export function specRoot(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  return join(clewDataDir(env, process.platform, homedir()), projectKey(findProjectRoot(cwd)), 'spec');
}

export function specSessionDir(id: string, env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  return join(specRoot(env, cwd), id);
}

// Per-user spec store location. Nothing here is inside the repo.
import { homedir } from 'node:os';
import { join } from 'node:path';

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

export function specRoot(env: NodeJS.ProcessEnv = process.env): string {
  const dataDir = clewDataDir(env, process.platform, homedir());
  return join(dataDir, 'spec');
}

export function specSessionDir(id: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(specRoot(env), id);
}

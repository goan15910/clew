// Per-user spec store location. Nothing here is inside the repo.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LEGACY_PROJECT_KEY = /-[0-9a-f]{12}$/;

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
  const root = join(dataDir, 'spec');
  migrateProjectSessions(dataDir, root);
  return root;
}

export function specSessionDir(id: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(specRoot(env), id);
}

/**
 * Moves sessions from the old per-project `<data dir>/<project-key>/spec/<id>` layout into `root`,
 * dropping the origin path they recorded. When two projects share an id, the first one read wins.
 */
export function migrateProjectSessions(dataDir: string, root: string): void {
  let projects;
  try {
    projects = readdirSync(dataDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const project of projects) {
    if (!project.isDirectory() || !LEGACY_PROJECT_KEY.test(project.name)) continue;
    const legacy = join(dataDir, project.name, 'spec');
    if (!existsSync(legacy)) continue;
    let stranded = false;
    for (const session of readdirSync(legacy, { withFileTypes: true })) {
      if (!session.isDirectory()) continue;
      const from = join(legacy, session.name);
      const to = join(root, session.name);
      if (existsSync(to)) continue;
      forgetOrigin(from);
      try {
        mkdirSync(root, { recursive: true });
        renameSync(from, to);
      } catch {
        stranded = true;
      }
    }
    if (!stranded) rmSync(join(dataDir, project.name), { recursive: true, force: true });
  }
}

function forgetOrigin(dir: string): void {
  try {
    const sessionFile = join(dir, 'session.json');
    const session = JSON.parse(readFileSync(sessionFile, 'utf8')) as Record<string, unknown>;
    delete session.specPath;
    writeFileSync(sessionFile, `${JSON.stringify(session, null, 2)}\n`);
  } catch {
    // An unreadable session moves as-is and reports its own fault on load.
  }
  try {
    const historyFile = join(dir, 'history.jsonl');
    const lines: string[] = [];
    for (const line of readFileSync(historyFile, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      const entry = JSON.parse(line) as { args?: Record<string, unknown> };
      if (entry.args !== undefined) delete entry.args.spec;
      lines.push(`${JSON.stringify(entry)}\n`);
    }
    writeFileSync(historyFile, lines.join(''));
  } catch {
    // No history, or history Clew never parses back.
  }
}

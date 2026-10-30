import { accessSync, constants, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { InstallLocation } from '../../application/ports.js';
import { CHANNELS, type BuildInfo } from '../../domain/upgrade.js';
import { readJson } from '../json/read-json.js';

const PackageJson = z.object({ version: z.string().min(1) });
const BuildInfoFile = z.object({
  version: z.string().min(1),
  channel: z.enum(CHANNELS as [string, ...string[]]),
  commit: z.string().min(7).optional(),
});

export const BUILD_INFO_FILE = 'build-info.json';

// src/adapters/upgrade and dist/adapters/upgrade are both three levels below the package root.
export function locateInstall(): InstallLocation {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const root = realpathSync(join(moduleDir, '..', '..', '..'));
  const build = readBuild(root);
  const prefix = globalPrefix(root);
  if (prefix === undefined) {
    return { kind: 'other', build, reason: `${root} is not <prefix>/lib/node_modules/clew of an npm global install` };
  }
  return { kind: 'global', build, prefix, writable: writable(join(prefix, 'lib', 'node_modules')) && writable(join(prefix, 'bin')) };
}

function readBuild(root: string): BuildInfo {
  const stamped = readJson(join(root, BUILD_INFO_FILE));
  if (stamped.ok) {
    const parsed = BuildInfoFile.safeParse(stamped.value);
    if (parsed.success) {
      const info: BuildInfo = { version: parsed.data.version, channel: parsed.data.channel as BuildInfo['channel'] };
      if (parsed.data.commit !== undefined) info.commit = parsed.data.commit;
      return info;
    }
  }
  const pkg = readJson(join(root, 'package.json'));
  const parsed = pkg.ok ? PackageJson.safeParse(pkg.value) : undefined;
  return { version: parsed?.success === true ? parsed.data.version : '0.0.0', channel: 'local' };
}

function globalPrefix(root: string): string | undefined {
  const modules = dirname(root);
  const lib = dirname(modules);
  if (basename(root) !== 'clew' || basename(modules) !== 'node_modules' || basename(lib) !== 'lib') return undefined;
  return dirname(lib);
}

function writable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

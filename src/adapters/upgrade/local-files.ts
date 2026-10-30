import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { UpgradePorts } from '../../application/ports.js';
import { CHANNELS, type BuildInfo } from '../../domain/upgrade.js';
import { BUILD_INFO_FILE } from './install-location.js';
import { API_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS, get } from './http.js';

const PackageJson = z.object({ version: z.string().min(1) });
const BuildInfoFile = z.object({ channel: z.enum(CHANNELS as [string, ...string[]]), commit: z.string().optional() });

function member(tarball: string, name: string): string | undefined {
  const result = spawnSync('tar', ['-xOzf', tarball, `package/${name}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : undefined;
}

export const localFiles: UpgradePorts['files'] = {
  makeTempDir: () => mkdtempSync(join(tmpdir(), 'clew-upgrade-')),
  removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
  async fetchText(url) {
    const response = await get(url, {}, API_TIMEOUT_MS);
    if (!response.ok) return response;
    return { ok: true, value: await response.value.text() };
  },
  async download(url, file) {
    const response = await get(url, {}, DOWNLOAD_TIMEOUT_MS);
    if (!response.ok) return response;
    try {
      writeFileSync(file, Buffer.from(await response.value.arrayBuffer()));
    } catch (error) {
      return { ok: false, message: `download of ${url} failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    return { ok: true, value: undefined };
  },
  async sha256(file) {
    const hash = createHash('sha256');
    await pipeline(createReadStream(file), hash);
    return hash.digest('hex');
  },
  inspect(tarball) {
    const pkg = member(tarball, 'package.json');
    const parsedPkg = pkg === undefined ? undefined : PackageJson.safeParse(JSON.parse(pkg));
    if (parsedPkg?.success !== true) return { ok: false, message: `${tarball} has no package/package.json` };
    const info: BuildInfo = { version: parsedPkg.data.version, channel: 'release' };
    const stamped = member(tarball, BUILD_INFO_FILE);
    const parsedInfo = stamped === undefined ? undefined : BuildInfoFile.safeParse(JSON.parse(stamped));
    if (parsedInfo?.success === true) {
      info.channel = parsedInfo.data.channel as BuildInfo['channel'];
      if (parsedInfo.data.commit !== undefined) info.commit = parsedInfo.data.commit;
    }
    return { ok: true, value: info };
  },
};

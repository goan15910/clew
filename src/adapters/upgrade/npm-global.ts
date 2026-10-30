import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { UpgradePorts } from '../../application/ports.js';
import { REPO } from './github-releases.js';

function run(command: string, args: string[]): Promise<{ status: number | null; stderr: string; failed?: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => resolve({ status: null, stderr, failed: error.message }));
    child.on('close', (status) => resolve({ status, stderr }));
  });
}

export const npmGlobal: UpgradePorts['npm'] = {
  async install(tarball, prefix) {
    const result = await run('npm', ['install', '-g', tarball, '--prefix', prefix]);
    if (result.status === 0) return { ok: true, value: undefined };
    return { ok: false, message: `npm install -g failed: ${result.failed ?? result.stderr.trim()}` };
  },
  installedVersion(prefix) {
    const result = spawnSync(join(prefix, 'bin', 'clew'), ['--version'], { encoding: 'utf8' });
    if (result.status !== 0) return { ok: false, message: `could not run ${join(prefix, 'bin', 'clew')} --version after install` };
    return { ok: true, value: result.stdout.trim() };
  },
};

export const ghProvenance: UpgradePorts['provenance'] = {
  async verify(tarball) {
    const result = await run('gh', ['attestation', 'verify', tarball, '--repo', REPO]);
    if (result.status === 0) return { ok: true, value: undefined };
    return { ok: false, message: `gh attestation verify failed: ${result.failed ?? result.stderr.trim()}` };
  },
};

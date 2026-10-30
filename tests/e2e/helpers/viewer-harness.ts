// Plants the checked-in session fixture and starts the same localhost serve path as `clew spec view --open`.

import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specSessionDir } from '../../../src/adapters/spec-store/data-dir.js';
import { jsonSpecSessionViewer, serveSessionViewer, type SessionViewerServer } from '../../../src/adapters/spec-store/session-viewer.js';
import { FIXTURE_DIR, FIXTURE_SESSION_ID } from './fixture-data.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

export interface RunningViewer {
  url: string;
  sessionId: string;
  dataDir: string;
  sessionDir: string;
  stop: () => Promise<void>;
}

function plantFixture(dataDir: string): string {
  const sessionDir = specSessionDir(FIXTURE_SESSION_ID, { CLEW_DATA_DIR: dataDir });
  mkdirSync(dirname(sessionDir), { recursive: true });
  cpSync(FIXTURE_DIR, sessionDir, { recursive: true });
  // Drop non-session files the store does not serve as domain JSON.
  rmSync(join(sessionDir, 'spec.md'), { force: true });
  return sessionDir;
}

function stubOpenBin(): string {
  const bin = mkdtempSync(join(tmpdir(), 'clew-open-stub-'));
  const script = '#!/bin/sh\nexit 0\n';
  writeFileSync(join(bin, 'xdg-open'), script, { mode: 0o755 });
  writeFileSync(join(bin, 'open'), script, { mode: 0o755 });
  return bin;
}

async function readViewDocument(child: ChildProcess): Promise<{ url: string; htmlPath: string; sessionDir: string }> {
  let stdout = '';
  let stderr = '';
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for clew spec view --open JSON\nstdout=${stdout}\nstderr=${stderr}`));
    }, 20_000);
    const tryParse = () => {
      const trimmed = stdout.trim();
      if (!trimmed.startsWith('{')) return;
      try {
        const doc = JSON.parse(trimmed) as { ok?: boolean; url?: string; htmlPath?: string; sessionDir?: string; issues?: Array<{ message: string }> };
        if (doc.url && doc.htmlPath && doc.sessionDir) {
          clearTimeout(timer);
          resolve({ url: doc.url, htmlPath: doc.htmlPath, sessionDir: doc.sessionDir });
        } else if (doc.ok === false) {
          clearTimeout(timer);
          reject(new Error(`spec view failed: ${JSON.stringify(doc.issues ?? doc)}`));
        }
      } catch {
        // still accumulating JSON
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      tryParse();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`clew spec view exited ${code}\nstdout=${stdout}\nstderr=${stderr}`));
      }
    });
  });
}

/** Spawn `clew spec view <id> --open --json` (browser open stubbed). Prefer `startViewerWithServeApi` in CI. */
export async function startViewerWithCliOpen(): Promise<RunningViewer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'clew-e2e-'));
  const sessionDir = plantFixture(dataDir);
  const openBin = stubOpenBin();
  const child = spawn(tsx, ['src/cli.ts', 'spec', 'view', FIXTURE_SESSION_ID, '--open', '--json'], {
    cwd: root,
    env: {
      ...process.env,
      CLEW_DATA_DIR: dataDir,
      PATH: `${openBin}:${process.env.PATH ?? ''}`,
      BROWSER: join(openBin, 'xdg-open'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const doc = await readViewDocument(child);
    return {
      url: doc.url,
      sessionId: FIXTURE_SESSION_ID,
      dataDir,
      sessionDir: doc.sessionDir,
      stop: async () => {
        if (!child.killed) {
          child.kill('SIGTERM');
          await new Promise<void>((done) => {
            child.once('exit', () => done());
            setTimeout(done, 2000);
          });
        }
        rmSync(openBin, { recursive: true, force: true });
        rmSync(dataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    child.kill('SIGTERM');
    rmSync(openBin, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
}

/** Install + serveSessionViewer in-process (same HTTP server as `clew spec view --open`). */
export async function startViewerWithServeApi(): Promise<RunningViewer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'clew-e2e-serve-'));
  const previous = process.env.CLEW_DATA_DIR;
  process.env.CLEW_DATA_DIR = dataDir;
  try {
    const sessionDir = plantFixture(dataDir);
    const installed = jsonSpecSessionViewer.install(FIXTURE_SESSION_ID);
    if (!installed.ok) throw new Error(installed.message);
    const server: SessionViewerServer = await serveSessionViewer(installed.sessionDir);
    return {
      url: server.url,
      sessionId: FIXTURE_SESSION_ID,
      dataDir,
      sessionDir,
      stop: async () => {
        await server.close();
        if (previous === undefined) delete process.env.CLEW_DATA_DIR;
        else process.env.CLEW_DATA_DIR = previous;
        rmSync(dataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (previous === undefined) delete process.env.CLEW_DATA_DIR;
    else process.env.CLEW_DATA_DIR = previous;
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
}

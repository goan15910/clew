// Writes the stable session viewer and (optionally) serves it on localhost.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync, type Stats } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { SpecSessionViewer, SpecViewerInstallResult } from '../../application/ports.js';
import { SPEC_SESSION_ID_PATTERN } from '../../domain/spec.js';
import { specRoot } from './data-dir.js';
import { VIEWER_FILE, VIEWER_HTML } from './viewer-page.js';

function isSessionId(id: string): boolean {
  return SPEC_SESSION_ID_PATTERN.test(id);
}

function sessionIdMessage(id: string): string {
  return `session id "${id}" is not a safe name`;
}

function locateSession(id: string): { ok: true; root: string; dir: string } | { ok: false; message: string } {
  if (!isSessionId(id)) return { ok: false, message: sessionIdMessage(id) };
  const root = specRoot();
  const dir = join(root, id);
  if (resolve(dir) !== join(resolve(root), id)) return { ok: false, message: sessionIdMessage(id) };
  return { ok: true, root, dir };
}

function confinedToSession(root: string, dir: string, id: string): boolean {
  try {
    return relative(realpathSync(root), realpathSync(dir)) === id;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

export const jsonSpecSessionViewer: SpecSessionViewer = {
  install(id): SpecViewerInstallResult {
    const located = locateSession(id);
    if (!located.ok) return { ok: false, fault: 'unreadable', message: located.message };
    let info: Stats;
    try {
      info = lstatSync(located.dir);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { ok: false, fault: 'missing', message: `no spec session "${id}"` };
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, fault: 'unreadable', message: `cannot open spec session "${id}": ${message}` };
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      return { ok: false, fault: 'unreadable', message: `spec session "${id}" is not a directory` };
    }
    if (!confinedToSession(located.root, located.dir, id)) {
      return { ok: false, fault: 'unreadable', message: sessionIdMessage(id) };
    }
    if (!existsSync(join(located.dir, 'session.json'))) {
      return { ok: false, fault: 'unreadable', message: `spec session "${id}" has no session.json` };
    }
    const htmlPath = join(located.dir, VIEWER_FILE);
    try {
      writeFileSync(htmlPath, VIEWER_HTML, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, fault: 'unreadable', message: `cannot write ${VIEWER_FILE}: ${message}` };
    }
    return { ok: true, session: id, htmlPath, sessionDir: located.dir };
  },
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export interface SessionViewerServer {
  url: string;
  close: () => Promise<void>;
}

function safeFile(sessionDir: string, requestPath: string): string | undefined {
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '');
  const relativePath = decoded === '/' || decoded === '' ? VIEWER_FILE : decoded.replace(/^\//, '');
  if (relativePath.includes('\0') || relativePath.split(/[/\\]/).includes('..')) return undefined;
  const absolute = resolve(sessionDir, relativePath);
  const root = resolve(sessionDir);
  if (absolute !== root && !absolute.startsWith(root + sep)) return undefined;
  return absolute;
}

export function serveSessionViewer(sessionDir: string): Promise<SessionViewerServer> {
  const root = realpathSync(sessionDir);
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('method not allowed');
      return;
    }
    const target = safeFile(root, request.url ?? '/');
    if (target === undefined) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('bad path');
      return;
    }
    let body: Buffer;
    try {
      body = readFileSync(target);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    const type = CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': body.length,
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    response.end(body);
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('viewer server has no TCP address'));
        return;
      }
      resolvePromise({
        url: `http://127.0.0.1:${address.port}/${VIEWER_FILE}`,
        close: () => new Promise((done, fail) => {
          server.close((error) => {
            if (error) fail(error);
            else done();
          });
        }),
      });
    });
  });
}

export function openViewerUrl(url: string): { ok: true } | { ok: false; message: string } {
  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `cannot open browser: ${message}` };
  }
}

export function waitForInterrupt(): Promise<void> {
  return new Promise((resolvePromise) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolvePromise();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

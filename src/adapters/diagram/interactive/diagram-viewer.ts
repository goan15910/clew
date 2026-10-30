// Install and optionally serve a standalone chart/workflows HTML viewer (shared Cytoscape assets).
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import type { DiagramViewDocument } from '../../../application/documents.js';
import { packageVersion } from '../../package/package-version.js';
import { installInteractiveGraphAssets } from './assets.js';
import { DIAGRAM_JSON_FILE, DIAGRAM_VIEWER_FILE, diagramViewerHtml } from './diagram-page.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export interface DiagramViewerServer {
  url: string;
  close: () => Promise<void>;
}

export interface DiagramInstallResult {
  ok: true;
  htmlPath: string;
  viewDir: string;
}

export type DiagramInstallFailure = { ok: false; message: string };

/** Payload written beside viewer.html for the browser mount (interactive charts/workflows only). */
export interface DiagramJsonPayload {
  command: DiagramViewDocument['command'];
  chartFile?: string;
  workflowsFile?: string;
  charts: DiagramViewDocument['charts'];
  workflows: DiagramViewDocument['workflows'];
}

export function installDiagramViewer(document: DiagramViewDocument): DiagramInstallResult | DiagramInstallFailure {
  let viewDir: string;
  try {
    viewDir = mkdtempSync(join(tmpdir(), 'clew-diagram-'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `cannot create diagram view directory: ${message}` };
  }
  const assets = installInteractiveGraphAssets(viewDir);
  if (!assets.ok) return assets;
  const installed = packageVersion();
  const htmlPath = join(viewDir, DIAGRAM_VIEWER_FILE);
  try {
    writeFileSync(htmlPath, diagramViewerHtml(installed.ok ? installed.version : 'unknown'), 'utf8');
    const payload: DiagramJsonPayload = {
      command: document.command,
      chartFile: document.chartFile,
      workflowsFile: document.workflowsFile,
      charts: document.charts,
      workflows: document.workflows,
    };
    writeFileSync(join(viewDir, DIAGRAM_JSON_FILE), JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `cannot write diagram viewer: ${message}` };
  }
  return { ok: true, htmlPath, viewDir };
}

function safeFile(root: string, requestPath: string): string | undefined {
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '');
  const relativePath = decoded === '/' || decoded === '' ? DIAGRAM_VIEWER_FILE : decoded.replace(/^\//, '');
  if (relativePath.includes('\0') || relativePath.split(/[/\\]/).includes('..')) return undefined;
  const absolute = resolve(root, relativePath);
  const base = resolve(root);
  if (absolute !== base && !absolute.startsWith(base + sep)) return undefined;
  return absolute;
}

export function serveDiagramViewer(viewDir: string): Promise<DiagramViewerServer> {
  mkdirSync(viewDir, { recursive: true });
  const root = resolve(viewDir);
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
        reject(new Error('diagram viewer server has no TCP address'));
        return;
      }
      resolvePromise({
        url: `http://127.0.0.1:${address.port}/${DIAGRAM_VIEWER_FILE}`,
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

export function openDiagramViewerUrl(url: string): { ok: true } | { ok: false; message: string } {
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

export function waitForDiagramInterrupt(): Promise<void> {
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

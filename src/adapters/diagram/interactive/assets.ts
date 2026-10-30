// Install vendored Cytoscape assets next to a viewer HTML (no CDN).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INTERACTIVE_GRAPH_ASSET_FILES,
  INTERACTIVE_GRAPH_CLIENT_FILE,
  INTERACTIVE_GRAPH_VENDOR_FILES,
} from './types.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Directory that holds committed vendor UMD builds (src or dist). */
export function interactiveGraphVendorDir(): string {
  return join(here, 'vendor');
}

/** Path to the browser mount script (src/client or dist/client). */
export function interactiveGraphClientPath(): string {
  return join(here, 'client', INTERACTIVE_GRAPH_CLIENT_FILE);
}

/**
 * Copy vendored Cytoscape + client mount into `targetDir`.
 * Safe to call from `spec view` install and from `chart view` / `workflows view`.
 */
export function installInteractiveGraphAssets(targetDir: string): { ok: true; files: string[] } | { ok: false; message: string } {
  try {
    mkdirSync(targetDir, { recursive: true });
    const files: string[] = [];
    for (const name of INTERACTIVE_GRAPH_VENDOR_FILES) {
      const from = join(interactiveGraphVendorDir(), name);
      const to = join(targetDir, name);
      copyFileSync(from, to);
      files.push(name);
    }
    const clientSource = readFileSync(interactiveGraphClientPath(), 'utf8');
    writeFileSync(join(targetDir, INTERACTIVE_GRAPH_CLIENT_FILE), clientSource, 'utf8');
    files.push(INTERACTIVE_GRAPH_CLIENT_FILE);
    return { ok: true, files };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `cannot install interactive graph assets: ${message}` };
  }
}

/** Script tags a host HTML page needs before calling `window.ClewInteractiveGraph.mount`. */
export function interactiveGraphScriptTags(): string {
  return INTERACTIVE_GRAPH_ASSET_FILES.map((name) => `<script src="${name}"></script>`).join('\n');
}

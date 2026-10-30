import type { Fetched } from '../../application/ports.js';

export const API_TIMEOUT_MS = 20_000;
export const DOWNLOAD_TIMEOUT_MS = 120_000;

export async function get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<Fetched<Response>> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { 'user-agent': 'clew-upgrade', ...headers }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  } catch (error) {
    return { ok: false, message: `could not reach ${url}: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (response.status === 403 || response.status === 429) {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const when = Number.isFinite(reset) && reset > 0 ? ` Limit resets at ${new Date(reset * 1000).toISOString()}.` : '';
    return { ok: false, message: `GitHub refused ${url} (HTTP ${response.status}).${when} Set GITHUB_TOKEN, or pass --version to skip the API.` };
  }
  if (!response.ok) return { ok: false, message: `${url} returned HTTP ${response.status}` };
  return { ok: true, value: response };
}

import { z } from 'zod';
import type { EdgeRelease, Fetched, Release, UpgradePorts } from '../../application/ports.js';
import { API_TIMEOUT_MS, get } from './http.js';

export const REPO = 'goan15910/clew';
export const EDGE_TAG = 'edge';

const Asset = z.object({ name: z.string(), browser_download_url: z.string(), digest: z.string().nullish() });
const ReleaseJson = z.object({ tag_name: z.string(), prerelease: z.boolean(), draft: z.boolean().optional(), assets: z.array(Asset) });
const RefJson = z.object({ object: z.object({ sha: z.string(), type: z.string() }) });

function apiBase(): string {
  return (process.env.CLEW_GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
}

function webBase(): string {
  return (process.env.CLEW_GITHUB_URL ?? 'https://github.com').replace(/\/$/, '');
}

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token !== undefined && token !== '') headers.authorization = `Bearer ${token}`;
  return headers;
}

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<Fetched<T>> {
  const url = `${apiBase()}/repos/${REPO}${path}`;
  const response = await get(url, apiHeaders(), API_TIMEOUT_MS);
  if (!response.ok) return response;
  const parsed = schema.safeParse(await response.value.json().catch(() => undefined));
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, message: `${url} returned an unexpected shape` };
}

function toRelease(json: z.infer<typeof ReleaseJson>): Release {
  return {
    tag: json.tag_name,
    prerelease: json.prerelease,
    assets: json.assets.map((asset) => {
      const entry: Release['assets'][number] = { name: asset.name, url: asset.browser_download_url };
      if (asset.digest !== null && asset.digest !== undefined) entry.sha256 = asset.digest;
      return entry;
    }),
  };
}

async function edge(): Promise<Fetched<EdgeRelease>> {
  const release = await getJson(`/releases/tags/${EDGE_TAG}`, ReleaseJson);
  if (!release.ok) return release;
  const ref = await getJson(`/git/ref/tags/${EDGE_TAG}`, RefJson);
  if (!ref.ok) return ref;
  let commit = ref.value.object.sha;
  if (ref.value.object.type === 'tag') {
    const tag = await getJson(`/git/tags/${commit}`, z.object({ object: z.object({ sha: z.string() }) }));
    if (!tag.ok) return tag;
    commit = tag.value.object.sha;
  }
  return { ok: true, value: { commit, release: toRelease(release.value) } };
}

export const githubReleases: UpgradePorts['releases'] = {
  async list() {
    const listed = await getJson('/releases?per_page=100', z.array(ReleaseJson));
    if (!listed.ok) return listed;
    return { ok: true, value: listed.value.filter((release) => release.draft !== true).map(toRelease) };
  },
  edge,
  direct(tag) {
    const version = tag.replace(/^v/, '');
    const url = (name: string) => `${webBase()}/${REPO}/releases/download/${tag}/${name}`;
    return {
      tag,
      prerelease: false,
      assets: [
        { name: `clew-${version}.tgz`, url: url(`clew-${version}.tgz`) },
        { name: 'SHA256SUMS', url: url('SHA256SUMS') },
      ],
    };
  },
};

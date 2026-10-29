// Read a span lexicon JSON file. Zod stays at this boundary.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { LexiconEntry } from '../../domain/spec-spans.js';

const EntryObjectSchema = z.strictObject({
  id: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
});

const EntriesFileSchema = z.strictObject({
  entries: z.array(
    z.strictObject({
      id: z.string().min(1).optional(),
      key: z.string().min(1),
      tags: z.array(z.string().min(1)).optional(),
    }),
  ),
});

export type LexiconLoad =
  | { ok: true; entries: LexiconEntry[] }
  | { ok: false; message: string };

export function loadSpanLexicon(file: string): LexiconLoad {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unreadable lexicon';
    return { ok: false, message: `${file}: ${message}` };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: `${file}: lexicon must be a JSON object` };
  }
  if ('entries' in raw) {
    const parsed = EntriesFileSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, message: zodMessage(file, parsed.error) };
    const entries: LexiconEntry[] = [];
    for (const item of parsed.data.entries) {
      entries.push({
        id: item.id ?? defaultEntryId(item.key),
        key: item.key,
        tags: item.tags?.slice() ?? [],
      });
    }
    if (entries.length === 0) return { ok: false, message: `${file}: lexicon has no entries` };
    return { ok: true, entries };
  }

  const entries: LexiconEntry[] = [];
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'string' && value !== '') {
      entries.push({ id: defaultEntryId(key), key, tags: [value] });
      continue;
    }
    if (Array.isArray(value)) {
      const tags: string[] = [];
      for (const tag of value) {
        if (typeof tag === 'string' && tag !== '') tags.push(tag);
      }
      entries.push({ id: defaultEntryId(key), key, tags });
      continue;
    }
    const parsed = EntryObjectSchema.safeParse(value);
    if (!parsed.success) return { ok: false, message: zodMessage(file, parsed.error, key) };
    const entryKey = parsed.data.key !== undefined && parsed.data.key !== '' ? parsed.data.key : key;
    entries.push({
      id: parsed.data.id ?? defaultEntryId(entryKey),
      key: entryKey,
      tags: parsed.data.tags?.slice() ?? [],
    });
  }
  if (entries.length === 0) return { ok: false, message: `${file}: lexicon has no entries` };
  return { ok: true, entries };
}

function defaultEntryId(key: string): string {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? 'entry' : slug;
}

function zodMessage(file: string, error: z.ZodError, prefix?: string): string {
  const issue = error.issues[0];
  const pathParts: string[] = [];
  if (prefix !== undefined) pathParts.push(prefix);
  if (issue !== undefined) {
    for (const part of issue.path) pathParts.push(String(part));
  }
  const path = pathParts.join('.');
  const detail = issue?.message ?? 'invalid lexicon';
  return path === '' ? `${file}: ${detail}` : `${file}: ${path}: ${detail}`;
}

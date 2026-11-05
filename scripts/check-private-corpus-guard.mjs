#!/usr/bin/env node
/**
 * Fail CI if public-repo privacy markers appear in tracked content.
 * Does not embed private corpus fingerprints (those stay offline).
 * Marker strings are assembled at runtime so this file is not itself a hit.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function joinParts(parts) {
  return parts.join('');
}

const patterns = [
  { re: new RegExp(joinParts(['\\b', 'JEF', '-?', '63', '\\b']), 'i'), kind: 'ticket_identifier' },
  { re: new RegExp(joinParts(['\\b', 'CW', '-?', '28', '\\b']), 'i'), kind: 'ticket_identifier' },
  {
    re: new RegExp(joinParts(['Train', 'ing ', 'Work', 'space']), 'i'),
    kind: 'product_name_reference',
  },
  {
    re: new RegExp(joinParts(['\\b', 'CLEW', '_', 'TW', '_', 'SPEC', '\\b'])),
    kind: 'env_gate',
  },
  {
    re: new RegExp(joinParts(['tw', '-', 'old', '-', 'baseline']), 'i'),
    kind: 'fixture_name',
  },
  {
    re: new RegExp(joinParts(['train', 'ing', '-', 'workspace', '\\.', 'harness']), 'i'),
    kind: 'harness_filename',
  },
  {
    re: new RegExp(joinParts(['private', '-?', 'golden']), 'i'),
    kind: 'private_golden_phrase',
  },
  {
    re: new RegExp(joinParts(['offline', '-?', 'golden']), 'i'),
    kind: 'offline_golden_phrase',
  },
  {
    re: new RegExp(joinParts(['phrase', '-', 'pilot']), 'i'),
    kind: 'internal_path_marker',
  },
];

const bannedPaths = [
  joinParts(['tests/spec/train', 'ing-workspace.harness.ts']),
  joinParts(['tests/fixtures/tw', '-old-baseline.json']),
];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const findings = [];

for (const path of bannedPaths) {
  if (files.includes(path)) {
    findings.push({ path, line: 0, kind: 'banned_path' });
  }
}

for (const path of files) {
  if (
    path.startsWith('node_modules/') ||
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.lock') ||
    path === 'scripts/check-private-corpus-guard.mjs' ||
    path === '.gitignore' ||
    path === 'AGENTS.md' ||
    path === '.pre-commit-config.yaml'
  ) {
    continue;
  }
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const { re, kind } of patterns) {
      if (re.test(lines[i])) {
        findings.push({ path, line: i + 1, kind });
      }
    }
  }
}

if (findings.length > 0) {
  console.error('Private-corpus / public-repo privacy guard failed:');
  for (const f of findings) {
    console.error(`  ${f.path}:${f.line}\t${f.kind}`);
  }
  console.error(
    '\nPrivate product corpora stay offline. Use tests/fixtures/synthetic-pipeline.md for CI.',
  );
  process.exit(1);
}

console.log('Private-corpus guard: ok');

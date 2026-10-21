// Turn Venom's JUnit XML into the GitHub Actions job summary.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'venom-results';

function attr(source, name) {
  const match = source.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? match[1] : '';
}

function bodies(source, tag) {
  const found = [];
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  for (const match of source.matchAll(pattern)) {
    let body = match[1].trim();
    const cdata = body.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
    if (cdata) body = cdata[1].trim();
    if (body !== '') found.push(body);
  }
  return found;
}

function clip(text) {
  const limit = 1500;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…`;
}

const lines = ['## Venom', ''];

if (!existsSync(dir)) {
  lines.push('Venom did not write a results directory.', '');
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(0);
}

const files = readdirSync(dir).filter((name) => name.endsWith('.xml')).sort();
if (files.length === 0) {
  lines.push('Venom did not write a JUnit XML report.', '');
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(0);
}

let passed = 0;
let failed = 0;
const failures = [];

for (const file of files) {
  const xml = readFileSync(join(dir, file), 'utf8');
  for (const suite of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g)) {
    const suiteName = attr(suite[1], 'name') || file;
    for (const test of suite[2].matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)) {
      const caseName = attr(test[1], 'name') || '(unnamed)';
      const className = attr(test[1], 'classname');
      const errors = [...bodies(test[2], 'error'), ...bodies(test[2], 'failure')];
      if (errors.length === 0) {
        passed += 1;
        continue;
      }
      failed += 1;
      failures.push({ suiteName, caseName, className, errors });
    }
  }
}

lines.push(`**${passed} passed, ${failed} failed.**`, '');
lines.push('The HTML report and JUnit XML are in the `venom-report` artifact. This summary is the readable view on the Actions run.', '');

if (failures.length > 0) {
  lines.push('### Failures', '');
  for (const failure of failures) {
    const where = failure.className ? `\`${failure.className}\`` : 'the suite';
    lines.push(`**${failure.suiteName} / ${failure.caseName}** (${where})`, '');
    lines.push('```', clip(failure.errors.join('\n')), '```', '');
  }
}

process.stdout.write(`${lines.join('\n')}\n`);

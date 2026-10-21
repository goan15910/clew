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

function commandMessage(text) {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function commandProperty(text) {
  return commandMessage(text).replace(/,/g, '%2C').replace(/:/g, '%3A');
}

function annotationLine(className, message) {
  if (!className) return '';
  const file = join('tests/venom', className);
  if (!existsSync(file)) return '';
  const named = message.match(/Testcase "([^"]+)"/);
  if (!named) return '';
  const lines = readFileSync(file, 'utf8').split('\n');
  const index = lines.findIndex((line) => line.includes(`name: ${named[1]}`));
  return index >= 0 ? `,line=${index + 1}` : '';
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
lines.push('The HTML report and JUnit XML are in the `venom-report` artifact. Each failure is also an annotation on this run.', '');

if (failures.length > 0) {
  lines.push('### Failures', '');
  const shown = failures.slice(0, 10);
  for (const failure of shown) {
    const where = failure.className ? `\`${failure.className}\`` : 'the suite';
    const message = clip(failure.errors.join('\n'));
    lines.push(`**${failure.suiteName} / ${failure.caseName}** (${where})`, '');
    lines.push('```', message, '```', '');
    if (process.env.GITHUB_ACTIONS === 'true') {
      const title = commandProperty(`${failure.suiteName} / ${failure.caseName}`);
      const file = failure.className ? ` file=tests/venom/${failure.className}${annotationLine(failure.className, message)}` : '';
      process.stderr.write(`::error${file},title=${title}::${commandMessage(message)}\n`);
    }
  }
  if (failures.length > shown.length) {
    lines.push(`${failures.length - shown.length} more failures are in the JUnit artifact.`, '');
  }
}

process.stdout.write(`${lines.join('\n')}\n`);

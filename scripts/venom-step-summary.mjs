// Turn Venom's JUnit XML into the GitHub Actions job summary.
// The summary is a per-suite table plus collapsible per-test details.
// Long assertion text is clipped so the step stays well under the 1 MiB summary limit.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'venom-results';
const CLIP = 1500;
const BUDGET = 256 * 1024;

function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attr(source, name) {
  const match = source.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? decodeEntities(match[1]) : '';
}

function bodies(source, tag) {
  const found = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  for (const match of source.matchAll(pattern)) {
    let body = match[1].trim();
    const cdata = body.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
    if (cdata) body = cdata[1].trim();
    else body = decodeEntities(body).trim();
    if (body !== '') found.push(body);
  }
  return found;
}

function clip(text) {
  const clean = text.replace(/\s+$/g, '');
  if (clean.length <= CLIP) return clean;
  return `${clean.slice(0, CLIP)}\n… truncated. The rest is in the \`venom-report\` artifact.`;
}

function commandMessage(text) {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function commandProperty(text) {
  return commandMessage(text).replace(/,/g, '%2C').replace(/:/g, '%3A');
}

function formatSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n < 10) return `${n.toFixed(3)}s`;
  return `${n.toFixed(1)}s`;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function tableCell(text) {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function quotedCaseName(assertion) {
  const named = assertion.match(/Testcase "([^"]+)"/);
  return named ? named[1] : '';
}

// Venom stores slug.Make(name) in the JUnit name attribute, with Lowercase left false.
function venomSlug(name) {
  return name.trim().replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

const suiteNames = new Map();

function namesInSuite(className) {
  if (!className) return new Map();
  if (suiteNames.has(className)) return suiteNames.get(className);
  const map = new Map();
  const file = join('tests/venom', className);
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^\s*-\s+name:\s+(.*?)\s*(?:#.*)?$/);
      if (!match) continue;
      let original = match[1];
      if ((original.startsWith('"') && original.endsWith('"')) || (original.startsWith("'") && original.endsWith("'"))) {
        original = original.slice(1, -1);
      }
      const slug = venomSlug(original);
      map.set(slug, map.has(slug) ? '' : original);
    }
  }
  suiteNames.set(className, map);
  return map;
}

function displayName(xmlName, className, assertion) {
  const quoted = quotedCaseName(assertion);
  if (quoted) return quoted;
  const mapped = namesInSuite(className).get(xmlName);
  return mapped || xmlName;
}

function findCaseLine(className, caseName) {
  if (!className || !caseName) return 0;
  const file = join('tests/venom', className);
  if (!existsSync(file)) return 0;
  const lines = readFileSync(file, 'utf8').split('\n');
  const needle = `name: ${caseName}`;
  const index = lines.findIndex((line) => {
    const at = line.indexOf(needle);
    if (at < 0) return false;
    const after = line.slice(at + needle.length).trim();
    return after === '' || after.startsWith('#');
  });
  return index >= 0 ? index + 1 : 0;
}

function lineFromAssertion(className, assertion) {
  if (!className || !assertion) return 0;
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = assertion.match(new RegExp(`\\(${escaped}:(\\d+)\\)`));
  if (!match) return 0;
  const line = Number(match[1]);
  return line > 0 ? line : 0;
}

function annotation(failure) {
  const message = clip(failure.assertion || 'The test failed. See the venom-report artifact.');
  const title = `${failure.suiteName} / ${failure.displayName}`;
  const props = [];
  if (failure.className) {
    props.push(`file=${commandProperty(`tests/venom/${failure.className}`)}`);
    const line = findCaseLine(failure.className, failure.displayName) || lineFromAssertion(failure.className, failure.assertion);
    if (line > 0) props.push(`line=${line}`);
  }
  props.push(`title=${commandProperty(title)}`);
  // A leading comma (`::error,title=`) is not a workflow command. Properties
  // always start with a space, including when the testcase has no classname.
  return `::error ${props.join(',')}::${commandMessage(message)}`;
}

function fence(text) {
  const marker = text.includes('```') ? '~~~~' : '```';
  return [marker, text, marker];
}

function parseFile(fileName, xml) {
  const suites = [];
  for (const suite of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g)) {
    const cases = [];
    for (const test of suite[2].matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const body = test[2] ?? '';
      const errors = [...bodies(body, 'error'), ...bodies(body, 'failure')];
      const assertion = errors.join('\n\n');
      const xmlName = attr(test[1], 'name') || '(unnamed)';
      cases.push({
        xmlName,
        displayName: displayName(xmlName, attr(test[1], 'classname'), assertion),
        className: attr(test[1], 'classname'),
        time: attr(test[1], 'time'),
        failed: errors.length > 0,
        skipped: /<skipped\b/.test(body),
        assertion,
      });
    }
    const failed = cases.filter((item) => item.failed).length;
    const skipped = cases.filter((item) => !item.failed && item.skipped).length;
    const time = attr(suite[1], 'time') || String(cases.reduce((sum, item) => sum + (Number(item.time) || 0), 0));
    suites.push({
      fileName,
      name: attr(suite[1], 'name') || fileName,
      tests: cases.length,
      passed: cases.length - failed - skipped,
      failed,
      skipped,
      time,
      cases,
    });
  }
  return suites;
}

function suiteDetails(suite) {
  const counts = [];
  if (suite.failed > 0) counts.push(`${suite.failed} failed`);
  counts.push(`${suite.passed} passed`);
  if (suite.skipped > 0) counts.push(`${suite.skipped} skipped`);
  const file = suite.cases.find((item) => item.className)?.className;
  const where = file ? `${suite.name} (${file})` : suite.name;
  const lines = ['<details>', `<summary>${escapeHtml(`${where} — ${counts.join(', ')}, ${formatSeconds(suite.time)}`)}</summary>`, ''];
  const ordered = [
    ...suite.cases.filter((item) => item.failed),
    ...suite.cases.filter((item) => !item.failed),
  ];
  for (const item of ordered) {
    const status = item.failed ? 'failed' : item.skipped ? 'skipped' : 'passed';
    lines.push(`**${status}** — ${item.displayName} (${formatSeconds(item.time)})`, '');
    if (item.failed) lines.push(...fence(clip(item.assertion || 'The test failed. See the venom-report artifact.')), '');
  }
  lines.push('</details>', '');
  return lines;
}

function fits(lines, extra) {
  const used = Buffer.byteLength(`${lines.join('\n')}\n`, 'utf8');
  const adding = Buffer.byteLength(`${extra.join('\n')}\n`, 'utf8');
  return used + adding <= BUDGET;
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

const suites = [];
for (const file of files) {
  suites.push(...parseFile(file, readFileSync(join(dir, file), 'utf8')));
}

const passed = suites.reduce((sum, suite) => sum + suite.passed, 0);
const failed = suites.reduce((sum, suite) => sum + suite.failed, 0);
const failures = suites.flatMap((suite) => suite.cases.filter((item) => item.failed).map((item) => ({
  suiteName: suite.name,
  displayName: item.displayName,
  className: item.className,
  assertion: item.assertion,
})));

if (process.env.GITHUB_ACTIONS === 'true') {
  for (const failure of failures) process.stderr.write(`${annotation(failure)}\n`);
}

lines.push('| suite | tests | passed | failed | time |', '| --- | ---: | ---: | ---: | ---: |');
for (const suite of suites) {
  lines.push(`| ${tableCell(suite.name)} | ${suite.tests} | ${suite.passed} | ${suite.failed} | ${formatSeconds(suite.time)} |`);
}
lines.push('');
lines.push(`**${passed} passed, ${failed} failed** across ${suites.length} ${suites.length === 1 ? 'suite' : 'suites'}.`, '');
lines.push('The JUnit XML, HTML report, and `venom.log` are in the `venom-report` artifact, kept for 14 days. Each failure is also an annotation on this run.', '');

let omitted = 0;
for (const suite of suites) {
  const details = suiteDetails(suite);
  if (fits(lines, details)) lines.push(...details);
  else omitted += 1;
}
if (omitted > 0) {
  lines.push(`${omitted} ${omitted === 1 ? 'suite was' : 'suites were'} left out of the details so this summary stays under GitHub's 1 MiB limit. The full results are in the \`venom-report\` artifact.`, '');
}

process.stdout.write(`${lines.join('\n')}\n`);

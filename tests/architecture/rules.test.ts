import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const semgrep = join(root, '.venv-semgrep/bin/semgrep');

interface Violation {
  rule: { name: string };
  from: string;
  to: string;
}

interface CruiseReport {
  summary: { advisedExitCode: number; violations: Violation[] };
  modules: {
    source: string;
    dependencies: { module: string; resolved: string; dependencyTypes: string[] }[];
  }[];
}

interface SemgrepReport {
  results: { check_id: string; path: string }[];
}

function cruise(args: string[]) {
  return spawnSync('node', [join(root, 'scripts/check-dependencies.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function cruiseJson(args: string[]): { status: number | null; report: CruiseReport } {
  const result = cruise(['--config', join(root, '.dependency-cruiser.cjs'), '--output-type', 'json', ...args]);
  let report: CruiseReport;
  try {
    report = JSON.parse(result.stdout) as CruiseReport;
  } catch {
    assert.fail(`dependency-cruiser did not return JSON (exit ${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return { status: report.summary.advisedExitCode, report };
}

function ruleNames(report: CruiseReport): string[] {
  return report.summary.violations.map((violation) => violation.rule.name);
}

function semgrepScan(target: string) {
  return spawnSync(
    semgrep,
    [
      'scan',
      '--config',
      join(root, 'semgrep/clew.yml'),
      '--metrics=off',
      '--disable-version-check',
      '--error',
      '--json',
      '--quiet',
      '--no-git-ignore',
      target,
    ],
    { cwd: root, encoding: 'utf8', env: { ...process.env, SEMGREP_SEND_METRICS: 'off' } },
  );
}

function semgrepJson(target: string): { status: number | null; report: SemgrepReport } {
  const result = semgrepScan(target);
  let report: SemgrepReport;
  try {
    report = JSON.parse(result.stdout) as SemgrepReport;
  } catch {
    assert.fail(`semgrep did not return JSON (exit ${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, report };
}

function checkIds(report: SemgrepReport): string[] {
  return report.results.map((finding) => finding.check_id);
}

function walkTs(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkTs(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

before(() => {
  const install = spawnSync('bash', [join(root, 'scripts/install-semgrep.sh')], { cwd: root, encoding: 'utf8' });
  assert.equal(install.status, 0, install.stderr || install.stdout);
});

describe('dependency-cruiser', { concurrency: false }, () => {
  test('src passes', () => {
    const result = cruise([]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });

  test('the err reporter exits non-zero for a planted zod import', () => {
    const result = cruise([
      '--config',
      join(root, '.dependency-cruiser.cjs'),
      '--output-type',
      'err',
      'tests/architecture/plants/domain-imports-zod/domain/bad.ts',
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /domain-no-library/);
  });

  test('domain importing an adapter fails', () => {
    const { status, report } = cruiseJson(['tests/architecture/plants/domain-imports-adapter/domain/bad.ts']);
    assert.notEqual(status, 0);
    assert.ok(ruleNames(report).includes('domain-no-outer-layer'));
    assert.ok(report.summary.violations.some((violation) => violation.to.endsWith('adapters/leak.ts')));
  });

  test('a type-only adapter import fails', () => {
    const { status, report } = cruiseJson(['tests/architecture/plants/domain-imports-adapter-type/domain/bad.ts']);
    assert.notEqual(status, 0);
    assert.ok(ruleNames(report).includes('domain-no-outer-layer'));
    const edge = report.modules
      .flatMap((mod) => mod.dependencies)
      .find((dependency) => dependency.resolved.endsWith('adapters/leak.ts'));
    assert.ok(edge);
    assert.ok(edge.dependencyTypes.includes('type-only'));
  });

  test('an adapter import through a tsconfig path fails', () => {
    const { status, report } = cruiseJson([
      '--ts-config',
      join(root, 'tests/architecture/tsconfig.json'),
      'tests/architecture/plants/domain-imports-adapter-alias/domain/bad.ts',
    ]);
    assert.notEqual(status, 0);
    assert.ok(ruleNames(report).includes('domain-no-outer-layer'));
    const edge = report.modules
      .flatMap((mod) => mod.dependencies)
      .find((dependency) => dependency.module === '@plants/adapters/leak.js');
    assert.ok(edge);
    assert.ok(edge.dependencyTypes.includes('aliased-tsconfig-paths'));
    assert.ok(edge.resolved.endsWith('adapters/leak.ts'));
  });

  test('domain importing zod fails', () => {
    const { status, report } = cruiseJson(['tests/architecture/plants/domain-imports-zod/domain/bad.ts']);
    assert.notEqual(status, 0);
    assert.ok(ruleNames(report).includes('domain-no-library'));
    assert.equal(ruleNames(report).includes('domain-no-outer-layer'), false);
  });

  test('a domain module that stays in the domain passes', () => {
    const { status, report } = cruiseJson(['tests/architecture/plants/domain-clean/domain/ok.ts']);
    assert.equal(status, 0, JSON.stringify(report.summary.violations));
    assert.equal(report.summary.violations.length, 0);
  });
});

describe('semgrep', { concurrency: false }, () => {
  test('src passes', () => {
    const { status, report } = semgrepJson('src');
    assert.equal(status, 0, JSON.stringify(report.results));
    assert.equal(report.results.length, 0);
  });

  test('domain importing an adapter fails', () => {
    const { status, report } = semgrepJson('tests/architecture/plants/domain-imports-adapter/domain/bad.ts');
    assert.notEqual(status, 0);
    assert.ok(checkIds(report).some((id) => id.includes('domain-imports-outer-layer')));
  });

  test('a type-only adapter import fails', () => {
    const { status, report } = semgrepJson('tests/architecture/plants/domain-imports-adapter-type/domain/bad.ts');
    assert.notEqual(status, 0);
    assert.ok(checkIds(report).some((id) => id.includes('domain-imports-outer-layer')));
  });

  test('an adapter import through a tsconfig path fails', () => {
    const { status, report } = semgrepJson('tests/architecture/plants/domain-imports-adapter-alias/domain/bad.ts');
    assert.notEqual(status, 0);
    assert.ok(checkIds(report).some((id) => id.includes('domain-imports-outer-layer')));
  });

  test('domain importing zod fails', () => {
    const { status, report } = semgrepJson('tests/architecture/plants/domain-imports-zod/domain/bad.ts');
    assert.notEqual(status, 0);
    assert.ok(checkIds(report).some((id) => id.includes('domain-imports-infra')));
    assert.equal(
      checkIds(report).some((id) => id.includes('domain-imports-outer-layer')),
      false,
    );
  });

  test('a domain module that stays in the domain passes', () => {
    const { status, report } = semgrepJson('tests/architecture/plants/domain-clean/domain/ok.ts');
    assert.equal(status, 0, JSON.stringify(report.results));
    assert.equal(report.results.length, 0);
  });
});

describe('source layout', () => {
  test('every src file is domain, application, adapters, or cli.ts', () => {
    const allowed = walkTs(join(root, 'src')).map((file) => relative(root, file));
    const stray = allowed.filter(
      (file) =>
        file !== 'src/cli.ts' &&
        !file.startsWith('src/domain/') &&
        !file.startsWith('src/application/') &&
        !file.startsWith('src/adapters/'),
    );
    assert.deepEqual(stray, []);
  });
});

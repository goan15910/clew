/** @type {import('dependency-cruiser').IConfiguration} */
// Layer and cycle rules for the JEF-29 hexagonal layout.
//
// parser is swc because dependency-cruiser 18 reads TypeScript with the
// compiler API and that API stops at TypeScript 6. Clew's compiler is
// TypeScript 7. @swc/core still records `import type` as a dependency
// (dependency type `type-only`). tsConfig is set so `paths` resolve;
// scripts/check-dependencies.mjs points dependency-cruiser at TypeScript 6
// for that read only. The product compiler stays TypeScript 7.
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Import cycles are forbidden.',
      from: { path: '^src/' },
      to: { circular: true },
    },
    {
      name: 'domain-no-outer-layer',
      severity: 'error',
      comment: 'Domain does not import application, ports, adapters, or the CLI.',
      from: { path: '(^|/)domain/' },
      to: { path: '(^|/)(application|adapters)/|(^|/)cli\\.ts$|(^|/)cli/' },
    },
    {
      name: 'domain-no-library',
      severity: 'error',
      comment:
        'Domain imports only other domain modules. No XState, Zod, YAML, the file system, Graphviz, or any other library.',
      from: { path: '(^|/)domain/' },
      to: { pathNot: '(^|/)domain/' },
    },
    {
      name: 'application-inward',
      severity: 'error',
      comment:
        'Application depends on domain, its own modules (including ports), and node:path. node:path is the one builtin the use cases already use for file basenames.',
      from: { path: '^src/application/' },
      to: { pathNot: ['^src/domain/', '^src/application/', '^path$'] },
    },
    {
      name: 'adapters-inward',
      severity: 'error',
      comment: 'Adapters depend inward: domain, application, and other adapters. Libraries are allowed. The CLI is not.',
      from: { path: '^src/adapters/' },
      to: {
        path: '^src/',
        pathNot: ['^src/domain/', '^src/application/', '^src/adapters/'],
      },
    },
    {
      name: 'cli-inward',
      severity: 'error',
      comment: 'CLI modules are the composition root. They may import src, zod, and commander.',
      from: { path: '^src/cli(\\.ts$|/)' },
      to: {
        pathNot: ['^src/', '^node_modules/zod/', '^node_modules/commander/', '^node_modules/@commander-js/extra-typings/'],
      },
    },
  ],
  options: {
    parser: 'swc',
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};

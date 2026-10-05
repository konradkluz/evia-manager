// Module boundaries (ADR-0001, ADR-0012; EVM-006 W13; apps/api module rules — EVM-008).
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Circular dependencies make modules impossible to reason about and to split.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolvable',
      comment: 'Every import must resolve (typo, missing dependency or file).',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'product-code-not-to-tools',
      comment: 'apps/*, services/* and packages/* never import tools/* (W13).',
      severity: 'error',
      from: { path: '^(apps|services|packages)/' },
      to: { path: '^tools/' },
    },
    {
      name: 'packages-not-to-apps-or-services',
      comment: 'Shared packages never depend on applications or services (W13).',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^(apps|services)/' },
    },
    {
      name: 'tools-not-to-apps-or-services',
      comment: 'Repository tools never import application or service code (W13).',
      severity: 'error',
      from: { path: '^tools/' },
      to: { path: '^(apps|services)/' },
    },
    {
      name: 'no-dev-dependencies-in-runtime-code',
      comment:
        'Runtime source (src/) must not use devDependencies (type-only imports are erased). packages/tokens/src and packages/contracts/src/build.ts, redocly*.ts are build-time code: consumers only get dist/.',
      severity: 'error',
      from: {
        path: '^(apps|services|packages)/[^/]+/src/',
        pathNot: ['\.test\.[cm]?[jt]sx?$', '^packages/tokens/', '^packages/contracts/src/(build|redocly|redocly-plugin)\.ts$'],
      },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'api-platform-not-to-modules',
      comment: 'platform is the shared kernel of apps/api: modules depend on it, never the other way round (ADR-0001).',
      severity: 'error',
      from: { path: '^apps/api/src/platform/' },
      to: { path: '^apps/api/src/modules/' },
    },
    {
      name: 'api-module-to-module-through-index',
      comment: 'A module uses another module only through its public API (modules/<name>/index.ts) (ADR-0001).',
      severity: 'error',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: { path: '^apps/api/src/modules/([^/]+)/', pathNot: ['^apps/api/src/modules/$1/', '^apps/api/src/modules/[^/]+/index\\.ts$'] },
    },
    {
      name: 'api-composition-through-index',
      comment: 'The composition root and platform code reach modules only through modules/<name>/index.ts (ADR-0001).',
      severity: 'error',
      from: { path: '^apps/api/src/', pathNot: '^apps/api/src/modules/' },
      to: { path: '^apps/api/src/modules/', pathNot: '^apps/api/src/modules/[^/]+/index\\.ts$' },
    },
    {
      name: 'api-domain-without-framework',
      comment: 'The domain layer of a module does not depend on NestJS, Express, Kysely or the pg driver (ADR-0001, ADR-0002).',
      severity: 'error',
      from: { path: '^apps/api/src/modules/[^/]+/domain/' },
      to: { path: 'node_modules/(@nestjs|express|kysely|pg)(/|$)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Generated output of our workspaces only — never node_modules (that would hide npm dependencies from the rules
    // above) and never a package's own dist/ inside node_modules (EVM-008).
    exclude: { path: '^(apps|packages|services|tools)/[^/]+/(dist|coverage|generated|\\.turbo)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};

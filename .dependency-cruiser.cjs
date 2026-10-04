// Module boundaries (ADR-0001, ADR-0012; EVM-006 W13). Module rules inside apps/api arrive with EVM-008.
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
      comment: 'Runtime source (src/) must not use devDependencies. packages/tokens/src is build-time code: consumers only get dist/.',
      severity: 'error',
      from: { path: '^(apps|services|packages)/[^/]+/src/', pathNot: ['\.test\.[cm]?[jt]sx?$', '^packages/tokens/'] },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|coverage|\.turbo)/' },
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

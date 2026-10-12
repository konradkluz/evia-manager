// Module boundaries (ADR-0001, ADR-0012; EVM-006 W13; apps/api and web rules — EVM-008).
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
      // Peer dependencies (react in packages/ui-web) are provided by the consuming application at runtime.
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only', 'npm-peer'] },
    },
    {
      name: 'api-src-not-to-dev',
      comment:
        'The production source never imports the development tools and the demo data in apps/api/dev (EVM-077 AC7): they are compiled separately, outside dist/ and the API image. The reverse direction (dev uses src) is allowed.',
      severity: 'error',
      from: { path: '^apps/api/src/' },
      to: { path: '^apps/api/dev/' },
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
      to: {
        path: '^apps/api/src/modules/([^/]+)/',
        // the system ports of the read model (`system-ports.ts`) are a separate entry file with its own rule below (ADR-0017 W5)
        pathNot: ['^apps/api/src/modules/$1/', '^apps/api/src/modules/[^/]+/index\\.ts$', '^apps/api/src/modules/[^/]+/system-ports\\.ts$'],
      },
    },
    {
      name: 'api-system-ports-only-from-overview',
      comment:
        'The system ports (modules/<name>/system-ports.ts) return minimal data WITHOUT a read policy and without a role (ADR-0017 W5, T8): only the application and infrastructure layers of `overview` may import them, and a module its own — never a controller, never another module.',
      severity: 'error',
      from: { path: '^apps/api/src/modules/([^/]+)/', pathNot: '^apps/api/src/modules/overview/(application|infrastructure)/' },
      to: { path: '^apps/api/src/modules/([^/]+)/system-ports\\.ts$', pathNot: '^apps/api/src/modules/$1/' },
    },
    {
      name: 'api-nothing-depends-on-overview',
      comment:
        'The read model is a leaf (ADR-0017 W5): it depends on the source modules, nothing depends on it. Only the composition root, the worker and the server command reach it, through index.ts.',
      severity: 'error',
      from: { path: '^apps/api/src/', pathNot: '^apps/api/src/(modules/overview/|app\\.module\\.ts$|cli/|worker(/|\\.ts$))' },
      to: { path: '^apps/api/src/modules/overview/' },
    },
    {
      name: 'api-pg-boss-only-in-jobs-adapter',
      comment:
        'The job queue library is imported only by its adapter (platform/jobs/pg-boss-job-queue.ts) and by the migration that builds its schema (ADR-0010; EVM-034): a module knows the interface JobQueue, never the library.',
      severity: 'error',
      from: { path: '^apps/api/src/', pathNot: '^apps/api/src/(platform/jobs/pg-boss-job-queue\\.ts$|migrations/0024_jobs\\.ts$)' },
      to: { path: 'node_modules/pg-boss(/|$)' },
    },
    {
      name: 'api-jobs-adapter-only-from-worker',
      comment:
        'The adapter of the queue is wired by the composition root of the worker only: a module and the platform use the interface (ADR-0010).',
      severity: 'error',
      from: { path: '^apps/api/src/', pathNot: '^apps/api/src/(platform/jobs/|worker/)' },
      to: { path: '^apps/api/src/platform/jobs/pg-boss-job-queue\\.ts$' },
    },
    {
      name: 'api-overview-http-not-to-jobs',
      comment: 'The HTTP layer of the read model does not see the background job (it is registered by the worker, not by a route).',
      severity: 'error',
      from: { path: '^apps/api/src/modules/overview/http/' },
      to: { path: '^apps/api/src/(modules/overview/application/verify-projection\\.job\\.ts$|platform/jobs/)' },
    },
    {
      name: 'no-module-imports-audit',
      comment:
        'Audited modules never import `audit`: the dependency points from audit to the exported events of the publisher, delivered through the platform event bus (ADR-0001 rule 4; EVM-016 W1). Only the composition root registers AuditModule.',
      severity: 'error',
      from: { path: '^apps/api/src/modules/(?!audit/)[^/]+/' },
      to: { path: '^apps/api/src/modules/audit/' },
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
    {
      name: 'web-ui-only-through-ui-web',
      comment: 'The panel takes components and icons only from @evia/ui-web (styleguide § 7.2, ADR-0006).',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: 'node_modules/(lucide-react|@base-ui|@radix-ui|tailwindcss)(/|$)' },
    },
    {
      name: 'ui-web-without-application-concerns',
      comment: 'The UI library takes texts and links as props: no router, i18n, data fetching or API contract (ADR-0006).',
      severity: 'error',
      from: { path: '^packages/ui-web/' },
      to: { path: '(^packages/contracts/|node_modules/(@evia/contracts|@tanstack|i18next|react-i18next)(/|$))' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Generated output of our workspaces only — never node_modules (that would hide npm dependencies from the rules
    // above) and never a package's own dist/ inside node_modules (EVM-008).
    exclude: { path: '^(apps|packages|services|tools)/[^/]+/(dist|coverage|generated|\\.turbo|\\.dev-build)/' },
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

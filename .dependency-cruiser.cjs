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
      name: 'deploy-agent-self-contained',
      comment:
        'EVM-007 (architect 1): the deployment verifier runs on the VM from its own image — it never imports applications, shared packages or tools (only node:* and yaml).',
      severity: 'error',
      // the lint and test configuration (eslint.config.js, vitest.config.ts) use the shared @evia/config at development time
      from: { path: '^services/deploy-agent/(src|test)/' },
      to: { path: '^(apps|packages|tools|services/(?!deploy-agent/))' },
    },
    {
      name: 'nothing-imports-deploy-agent',
      comment:
        'EVM-007 (architect 1): no other code depends on the verifier — two independent implementations (it and tools/main-integrity, K6).',
      severity: 'error',
      from: { pathNot: '^services/deploy-agent/' },
      to: { path: '^services/deploy-agent/' },
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
        // the facade of the totals of payments (`payments/payment-totals.ts`) is another entry file with its own rule below (EVM-056, K3)
        pathNot: [
          '^apps/api/src/modules/$1/',
          '^apps/api/src/modules/[^/]+/index\\.ts$',
          '^apps/api/src/modules/[^/]+/system-ports\\.ts$',
          '^apps/api/src/modules/payments/payment-totals\\.ts$',
        ],
      },
    },
    {
      name: 'api-payment-totals-only-from-overview',
      comment:
        'The facade of the totals of payments (modules/payments/payment-totals.ts) takes identifiers its CALLER has filtered with the read policy of work orders (one page of the list, ADR-0017 W2, the pattern C′): only the application layer of `overview` may import it — never a controller, never another module, so identifiers from a request cannot reach it (EVM-056; CWE-639, CWE-863).',
      severity: 'error',
      from: {
        path: '^apps/api/src/modules/([^/]+)/',
        pathNot: ['^apps/api/src/modules/overview/application/', '^apps/api/src/modules/payments/'],
      },
      to: { path: '^apps/api/src/modules/payments/payment-totals\\.ts$' },
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
        'The job queue library is imported only by its adapter (platform/jobs/pg-boss-job-queue.ts; ADR-0010; EVM-034): a module knows the interface JobQueue, never the library. The migration that builds its schema runs a frozen script and never imports it.',
      severity: 'error',
      from: { path: '^apps/api/src/', pathNot: '^apps/api/src/platform/jobs/pg-boss-job-queue\\.ts$' },
      to: { path: 'node_modules/pg-boss(/|$)' },
    },
    {
      name: 'api-aws-sdk-only-in-storage-adapters',
      comment:
        'EVM-044: the S3 SDK (@aws-sdk/*) is imported only by the object-storage and deletion-register adapters in platform; modules use the port.',
      severity: 'error',
      from: { path: '^apps/api/src/', pathNot: '^apps/api/src/platform/(object-storage|deletion-register)/' },
      to: { path: 'node_modules/@aws-sdk(/|$)' },
    },
    {
      name: 'api-smtp-only-in-email-adapter',
      comment:
        'The SMTP library is imported only by its adapter (platform/email/smtp-email-sender.ts; ADR-0010; EVM-024 (b)): there is one way to send an e-mail — the outbox, the queue `email.send`, the port `EmailSender` — and a module never opens its own connection.',
      severity: 'error',
      from: { path: '^apps/api/src/', pathNot: '^apps/api/src/platform/email/smtp-email-sender\\.ts$' },
      to: { path: 'node_modules/nodemailer(/|$)' },
    },
    {
      name: 'api-email-adapter-only-from-worker',
      comment:
        'The adapter of the SMTP transport is wired by the composition root of the worker only (and the other adapters of the e-mail port next to it): a module and the rest of the platform use the port `EmailSender` (EVM-024).',
      severity: 'error',
      from: { path: '^apps/api/src/', pathNot: '^apps/api/src/(platform/email/|worker/)' },
      to: { path: '^apps/api/src/platform/email/smtp-email-sender\\.ts$' },
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
      name: 'mobile-not-to-other-workspaces',
      comment: 'The mobile app imports no other application, service or tool (EVM-009; only shared packages).',
      severity: 'error',
      from: { path: '^apps/mobile/' },
      to: { path: '^(apps/(?!mobile/)|services/|tools/)' },
    },
    {
      name: 'nothing-depends-on-mobile',
      comment: 'Nothing imports the mobile app (EVM-009); shared code lives in packages/*.',
      severity: 'error',
      from: { path: '^(apps/(?!mobile/)|services/|packages/|tools/)' },
      to: { path: '^apps/mobile/' },
    },
    {
      name: 'mobile-ui-library-isolated',
      comment:
        'The mobile UI library takes texts and callbacks as props: no API, startup logic, secure store, configuration, i18n or screens — the precondition for moving it to packages/ui-mobile later (EVM-009; ADR-0007).',
      severity: 'error',
      from: { path: '^apps/mobile/src/ui/' },
      to: {
        path: '^apps/mobile/(src/(?!ui/)|plugins/|index\\.ts$)|(node_modules/(expo-secure-store|expo-constants|expo-application|i18next|react-i18next)(/|$))',
      },
    },
    {
      name: 'mobile-secure-store-only-in-token-store',
      comment:
        'Secrets live only in the secure store module (Keystore/Keychain); nothing else imports expo-secure-store (EVM-009; SR-MOB-01).',
      severity: 'error',
      from: { path: '^apps/mobile/', pathNot: '^apps/mobile/(src/secure-store|test)/' },
      to: { path: 'node_modules/expo-secure-store(/|$)' },
    },
    {
      name: 'mobile-no-async-storage',
      comment:
        'AsyncStorage keeps plain text on the phone: tokens and data of the app never go there (EVM-009; SR-MOB-01, MASVS-STORAGE-1).',
      severity: 'error',
      from: { path: '^apps/mobile/' },
      to: { path: 'node_modules/@react-native-async-storage(/|$)' },
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
    exclude: { path: '^(apps|packages|services|tools)/[^/]+/(dist|coverage|generated|\\.turbo|\\.dev-build|android|ios|\\.expo)/' },
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

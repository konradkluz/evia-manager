import type { CDPSession, Page } from '@playwright/test';

/** Problems seen by the browser while a test runs: console errors, page errors, CSP violations, foreign requests. */
export interface PageProblems {
  readonly console: string[];
  readonly page: string[];
  readonly foreignRequests: string[];
  cspViolations(): Promise<string[]>;
}

declare global {
  interface Window {
    __eviaCspViolations?: string[];
  }
}

/** Starts recording before the first navigation (init scripts run outside the page CSP). */
export async function watchPage(page: Page, origin: string): Promise<PageProblems> {
  const problems = { console: [] as string[], page: [] as string[], foreignRequests: [] as string[] };
  page.on('console', (message) => {
    if (message.type() === 'error') problems.console.push(message.text());
  });
  page.on('pageerror', (error) => problems.page.push(error.message));
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('data:') && new URL(url).origin !== origin) problems.foreignRequests.push(url);
  });
  await page.addInitScript(() => {
    window.__eviaCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__eviaCspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return {
    ...problems,
    cspViolations: () => page.evaluate(() => window.__eviaCspViolations ?? []),
  };
}

/** Chromium and Edge: a virtual authenticator with user verification (Firefox has none, ADR-0015). */
export async function virtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return cdp;
}

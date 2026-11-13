/** The address the panel bakes in as `VITE_PANEL_ORIGIN` (EVM-126 AC3, AC4). */
export const DEV_PANEL_ORIGIN = 'http://localhost:5173';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Resolves the panel address of a build. Development and CI builds fall back to the local address (AC4). A release build
 * (`EVIA_RELEASE_BUILD=true`, set by infra/images/web/Dockerfile) must get `PANEL_ORIGIN` — an https origin that is not a
 * local host — otherwise the build fails instead of shipping `localhost` in the production image (AC3).
 */
export function resolvePanelOrigin(env: Readonly<Record<string, string | undefined>>): string {
  const configured = env['PANEL_ORIGIN'] ?? '';
  if (env['EVIA_RELEASE_BUILD'] !== 'true') return configured === '' ? DEV_PANEL_ORIGIN : configured;
  let url: URL | undefined;
  try {
    url = new URL(configured);
  } catch {
    url = undefined;
  }
  if (url === undefined || url.protocol !== 'https:' || LOCAL_HOSTS.has(url.hostname) || url.origin !== configured)
    throw new Error(
      'Release build of the panel needs PANEL_ORIGIN: an https origin of the environment (not localhost), e.g. https://panel.eviacharge.pl',
    );
  return url.origin;
}

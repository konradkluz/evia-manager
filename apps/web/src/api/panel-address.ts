import { ApiError } from './client.ts';

/** The server rejects a state-changing request whose Origin is not the configured panel origin (EVM-077 AC6). */
export function isWrongOrigin(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === 'csrf_failed';
}

/** The supported panel address, taken from the build configuration (`VITE_PANEL_ORIGIN`); undefined when not configured. */
export function supportedPanelAddress(): string | undefined {
  const value: unknown = import.meta.env['VITE_PANEL_ORIGIN'];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

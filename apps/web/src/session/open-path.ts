import { useNavigate } from '@tanstack/react-router';
import type { WORK_ORDERS_PATH } from '../paths.ts';

/**
 * Opens a path of the panel (already validated, e.g. by `resolveReturnTo`) through the router, so that the route is
 * matched before the page behind it renders — a bare history change leaves a frame with the new address and the old
 * page. The replace keeps the login pages out of the history. Query parameters of the path are kept.
 */
export function useOpenPath(): (path: string) => Promise<void> {
  const navigate = useNavigate();
  return (path) => {
    const url = new URL(path, globalThis.location.origin);
    return navigate({
      to: url.pathname as typeof WORK_ORDERS_PATH,
      search: Object.fromEntries(url.searchParams) as never,
      replace: true,
    });
  };
}

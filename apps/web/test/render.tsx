import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { App } from '../src/app.tsx';
import { createApiClient } from '../src/api/client.ts';
import { ACTIVE_SESSION, createFakeApi, json, SESSION_ROUTE } from './api-fake.ts';

type FakeApi = ReturnType<typeof createFakeApi>;

/**
 * A fake API that has an active session, no work orders (the default of every panel test: W-10 is the first page), no active
 * templates and the one user of the session (what W-05 reads besides the searches; EVM-022).
 */
export function activeSessionApi(routes: Parameters<typeof createFakeApi>[0] = {}): FakeApi {
  return createFakeApi({
    [SESSION_ROUTE]: () => json(200, ACTIVE_SESSION),
    'GET /api/v1/work-orders': () => json(200, { items: [], nextCursor: null }),
    'GET /api/v1/catalog/work-order-templates': () => json(200, { items: [], nextCursor: null }),
    'GET /api/v1/users/assignable': () =>
      json(200, { items: [{ id: ACTIVE_SESSION.user.id, displayName: ACTIVE_SESSION.user.displayName }], nextCursor: null }),
    ...routes,
  });
}

/** Renders the whole panel at a path (memory history) against a fake API and waits for the page heading. */
export async function renderPanel(path = '/', api: FakeApi = activeSessionApi(), { heading = true } = {}) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const result = render(<App history={history} client={createApiClient(api.fetch)} />);
  if (heading) await screen.findByRole('heading', { level: 1 });
  return { ...result, history, api };
}

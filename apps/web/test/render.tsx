import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { App } from '../src/app.tsx';
import { createApiClient } from '../src/api/client.ts';
import { ACTIVE_SESSION, createFakeApi, json, SESSION_ROUTE } from './api-fake.ts';

type FakeApi = ReturnType<typeof createFakeApi>;

/** A fake API that has an active session (the default of every panel test). */
export function activeSessionApi(routes: Parameters<typeof createFakeApi>[0] = {}): FakeApi {
  return createFakeApi({ [SESSION_ROUTE]: () => json(200, ACTIVE_SESSION), ...routes });
}

/** Renders the whole panel at a path (memory history) against a fake API and waits for the page heading. */
export async function renderPanel(path = '/', api: FakeApi = activeSessionApi(), { heading = true } = {}) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const result = render(<App history={history} client={createApiClient(api.fetch)} />);
  if (heading) await screen.findByRole('heading', { level: 1 });
  return { ...result, history, api };
}

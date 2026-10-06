import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { App } from '../src/app.tsx';

/** Renders the whole panel at a path (memory history) and waits for the page heading. */
export async function renderPanel(path = '/') {
  const history = createMemoryHistory({ initialEntries: [path] });
  const result = render(<App history={history} />);
  await screen.findByRole('heading', { level: 1 });
  return { ...result, history };
}

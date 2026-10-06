// Must stay the first import: it removes the token of a one-time link from the address before anything else runs (AC5).
import './activation/capture-fragment.ts';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './app.tsx';
import './styles.css';

/** Mounts the panel in the #root element of index.html. */
export function mount(container: HTMLElement | null): Root {
  if (container === null) throw new Error('#root element is missing in index.html');
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return root;
}

mount(document.getElementById('root'));

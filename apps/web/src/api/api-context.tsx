import type { Client } from '@evia/contracts';
import { createContext, useContext, type ReactNode } from 'react';

const ApiContext = createContext<Client | null>(null);

/** Gives pages the one API client of the panel (a test passes a client with its own fetch). */
export function ApiProvider({ client, children }: { readonly client: Client; readonly children: ReactNode }) {
  return <ApiContext value={client}>{children}</ApiContext>;
}

export function useApi(): Client {
  const client = useContext(ApiContext);
  if (client === null) throw new Error('useApi outside ApiProvider');
  return client;
}

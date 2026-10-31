import { describe, expect, it } from 'vitest';
import { queueStoreConformance } from '../conformance/queue.ts';
import { InMemoryQueueStore } from './helpers.ts';

// The reference fake must satisfy the same contract that the SQLCipher adapter (EVM-093) has to satisfy.
queueStoreConformance({
  create: () => new InMemoryQueueStore(),
  test: { describe, it, expect },
  settledOf: (store) => Promise.resolve([...(store as InMemoryQueueStore).settled]),
  injectSettleFailure: (store) => {
    const fake = store as InMemoryQueueStore;
    fake.failOn = { method: 'settle', call: 1 };
  },
});

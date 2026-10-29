import { describe, expect, it } from 'vitest';
import { replicaStoreConformance } from '../conformance/replica.ts';
import { FakeReplica } from './pull-helpers.ts';

// The reference fake must satisfy the same contract that the SQLCipher adapter (EVM-093) has to satisfy.
replicaStoreConformance({ create: () => new FakeReplica(), test: { describe, it, expect } });

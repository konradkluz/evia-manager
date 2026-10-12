// NestJS reads decorator metadata through the Reflect API (polyfill loaded once per test file, as in src/main.ts).
import 'reflect-metadata';
import { afterEach } from 'vitest';
import { assertProjectionInSync } from './projection.ts';

// ADR-0017 test 8 (EVM-034): after every integration test the projection of the list equals its recomputation from the sources.
afterEach(async () => {
  await assertProjectionInSync();
});

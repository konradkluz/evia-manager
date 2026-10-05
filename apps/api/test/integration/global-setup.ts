/**
 * Global setup of the integration tests: the database server comes from EVIA_TEST_DATABASE_URL (compose service
 * `postgres`, ADR-0015 — no Docker socket in containers) or from Testcontainers (CI job backend-integration, a host
 * with Docker). Test files get the admin URL through `inject('adminDatabaseUrl')`.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { POSTGRES_IMAGE, POSTGRES_INITDB_ARGS } from '../support/postgres.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    adminDatabaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject): Promise<void> {
  const external = process.env['EVIA_TEST_DATABASE_URL'];
  if (external !== undefined && external !== '') {
    project.provide('adminDatabaseUrl', external);
    return;
  }
  container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withEnvironment({ POSTGRES_INITDB_ARGS })
    .withDatabase('evia')
    .withUsername('evia')
    .withPassword('synthetic-ci-password')
    .start();
  project.provide('adminDatabaseUrl', container.getConnectionUri());
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

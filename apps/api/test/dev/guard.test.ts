/**
 * The guard of the local environment — the half that runs in the process that writes (EVM-077 AC4). The same cases are run
 * against tools/dev-env/src/guard.mjs by tools/repo-policy, so the two implementations cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { databaseProblems, databaseUrlProblems, environmentProblems, MARKER } from '../../dev/guard.ts';

const GOOD = {
  NODE_ENV: 'development',
  WEBAUTHN_RP_ID: 'localhost',
  DATABASE_URL: 'postgres://evia:evia-local@localhost:5442/evia_dev',
};
const codes = (env: Record<string, string | undefined>): string[] => environmentProblems(env).map((problem) => problem.code);

describe('environment part of the guard (EVM-077 AC4)', () => {
  it('EVM-077 AC4: accepts exactly the local development setup', () => {
    expect(codes(GOOD)).toEqual([]);
    for (const host of ['localhost', '127.0.0.1', '[::1]'])
      expect(codes({ ...GOOD, DATABASE_URL: `postgres://u:p@${host}:5442/evia_dev` }), host).toEqual([]);
    expect(codes({ ...GOOD, DATABASE_URL: 'postgres://u:p@postgres-dev:5432/evia_dev', API_PORT: '3000' })).toEqual([]);
  });

  it('EVM-077 AC4: refuses another NODE_ENV, RP ID, API port and PG* variables', () => {
    expect(codes({ ...GOOD, NODE_ENV: 'production' })).toEqual(['node-env']);
    expect(codes({ ...GOOD, WEBAUTHN_RP_ID: 'evia.example' })).toEqual(['rp-id']);
    expect(codes({ ...GOOD, API_PORT: '3001' })).toEqual(['api-port']);
    expect(codes({ ...GOOD, PGOPTIONS: '-c evia.env=local-dev' })).toEqual(['pg-env']);
    expect(codes({})).toEqual(['node-env', 'rp-id', 'database-url']);
  });

  it('EVM-077 AC4: refuses a tunnel to a database called evia, host=, hostaddr=, options=, several hosts and wrong ports', () => {
    const url = (rest: string): Record<string, string> => ({ ...GOOD, DATABASE_URL: `postgres://u:p@${rest}` });
    expect(codes(url('localhost:5442/evia'))).toEqual(['database-name']);
    expect(codes(url('localhost:5442/%65via_dev'))).toEqual(['database-name']);
    for (const query of ['?host=db.example', '?hostaddr=10.0.0.1', '?options=-c%20evia.env%3Dlocal-dev', '?service=prod', '#x'])
      expect(codes(url(`localhost:5442/evia_dev${query}`)), query).toEqual(['database-query']);
    for (const host of ['db.example.com', '10.0.0.5', '0.0.0.0', 'localhost,db.example', 'postgres'])
      expect(codes(url(`${host}:5442/evia_dev`)), host).toEqual(['database-host']);
    for (const authority of ['localhost:5432', 'localhost', 'postgres-dev:6000'])
      expect(codes(url(`${authority}/evia_dev`)), authority).toEqual(['database-port']);
    for (const value of [undefined, '', 'nonsense', 'mysql://u:p@localhost:5442/evia_dev'])
      expect(
        databaseUrlProblems(value).map((problem) => problem.code),
        String(value),
      ).toEqual(['database-url']);
  });

  it('EVM-077 AC4: messages carry no value of a variable', () => {
    const text = environmentProblems({ ...GOOD, DATABASE_URL: 'postgres://zzuser:zzsecret@db.example.com:5442/evia_dev?host=zzhost' })
      .map((problem) => problem.message)
      .join('\n');
    for (const secret of ['zzuser', 'zzsecret', 'zzhost']) expect(text).not.toContain(secret);
  });
});

describe('database part of the guard (EVM-077 AC4)', () => {
  it('EVM-077 AC4: needs the database evia_dev and the marker stored in the database', () => {
    expect(databaseProblems({ currentDatabase: 'evia_dev', databaseSettings: [MARKER] })).toEqual([]);
    expect(databaseProblems({ currentDatabase: 'evia_dev', databaseSettings: ['other=1', MARKER] })).toEqual([]);
    expect(databaseProblems({ currentDatabase: 'evia_dev', databaseSettings: null }).map((problem) => problem.code)).toEqual(['db-marker']);
    expect(
      databaseProblems({ currentDatabase: 'evia_dev', databaseSettings: ['evia.env=production'] }).map((problem) => problem.code),
    ).toEqual(['db-marker']);
    expect(databaseProblems({ currentDatabase: 'evia', databaseSettings: [MARKER] }).map((problem) => problem.code)).toEqual(['db-name']);
    expect(databaseProblems({ currentDatabase: 'evia', databaseSettings: null }).map((problem) => problem.code)).toEqual([
      'db-name',
      'db-marker',
    ]);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { databaseUrlProblems, guardProblems } from '../src/guard.mjs';
import { parseDotenv } from '../src/dotenv.mjs';

const GOOD = {
  NODE_ENV: 'development',
  WEBAUTHN_RP_ID: 'localhost',
  DATABASE_URL: 'postgres://evia:evia-local@localhost:5442/evia_dev',
};
/** @param {Record<string, string | undefined>} env */
const codes = (env) => guardProblems(env).map((problem) => problem.code);

describe('EVM-077 AC4: the guard of the local environment (environment part)', () => {
  it('EVM-077 AC4: accepts exactly the local development setup, for every allowed host', () => {
    assert.deepEqual(codes(GOOD), []);
    for (const host of ['localhost', '127.0.0.1', '[::1]'])
      assert.deepEqual(codes({ ...GOOD, DATABASE_URL: `postgres://u:p@${host}:5442/evia_dev` }), [], host);
    assert.deepEqual(codes({ ...GOOD, DATABASE_URL: 'postgres://u:p@postgres-dev:5432/evia_dev' }), []);
    assert.deepEqual(codes({ ...GOOD, DATABASE_URL: 'postgresql://u:p@postgres-dev/evia_dev' }), []);
    assert.deepEqual(codes({ ...GOOD, API_PORT: '3000' }), []);
  });

  it('EVM-077 AC4: refuses another NODE_ENV, another RP ID and another API port', () => {
    for (const NODE_ENV of ['production', 'test', undefined]) assert.deepEqual(codes({ ...GOOD, NODE_ENV }), ['node-env']);
    assert.deepEqual(codes({ ...GOOD, WEBAUTHN_RP_ID: 'evia.example' }), ['rp-id']);
    assert.deepEqual(codes({ ...GOOD, WEBAUTHN_RP_ID: undefined }), ['rp-id']);
    assert.deepEqual(codes({ ...GOOD, API_PORT: '3001' }), ['api-port']);
  });

  it('EVM-077 AC4: refuses a tunnel on localhost to a database called evia, and every other name (also encoded)', () => {
    for (const name of ['evia', 'evia_dev2', '%65via_dev', 'evia_dev/x', '']) {
      assert.deepEqual(codes({ ...GOOD, DATABASE_URL: `postgres://u:p@localhost:5442/${name}` }), ['database-name'], name);
    }
    assert.deepEqual(codes({ ...GOOD, DATABASE_URL: 'postgres://u:p@localhost:5432/evia' }), ['database-name']);
  });

  it('EVM-077 AC4: refuses a query string, host= / hostaddr= / options= / service= and a fragment', () => {
    for (const query of [
      '?host=db.example',
      '?hostaddr=10.0.0.1',
      '?options=-c%20evia.env%3Dlocal-dev',
      '?service=prod',
      '?',
      '?sslmode=disable',
    ]) {
      assert.deepEqual(codes({ ...GOOD, DATABASE_URL: `postgres://u:p@localhost:5442/evia_dev${query}` }), ['database-query'], query);
    }
    assert.deepEqual(codes({ ...GOOD, DATABASE_URL: 'postgres://u:p@localhost:5442/evia_dev#x' }), ['database-query']);
  });

  it('EVM-077 AC4: refuses hosts outside the list, several hosts and wrong ports', () => {
    for (const host of ['db.example.com', '10.0.0.5', '0.0.0.0', 'localhost.evil.test', 'localhost,db.example', 'postgres']) {
      assert.deepEqual(codes({ ...GOOD, DATABASE_URL: `postgres://u:p@${host}:5442/evia_dev` }), ['database-host'], host);
    }
    for (const port of ['5432', '5433', '']) {
      assert.deepEqual(
        codes({ ...GOOD, DATABASE_URL: `postgres://u:p@localhost${port ? ':' + port : ''}/evia_dev` }),
        ['database-port'],
        port,
      );
    }
    assert.deepEqual(codes({ ...GOOD, DATABASE_URL: 'postgres://u:p@postgres-dev:6000/evia_dev' }), ['database-port']);
  });

  it('EVM-077 AC4: refuses a missing, empty or non-postgres DATABASE_URL', () => {
    for (const value of [undefined, '', 'not a url', 'mysql://u:p@localhost:5442/evia_dev', 'http://localhost:5442/evia_dev']) {
      assert.deepEqual(codes({ ...GOOD, DATABASE_URL: value }), ['database-url'], String(value));
    }
  });

  it('EVM-077 AC4: refuses PG* variables (they could redirect the connection) and lists every problem at once', () => {
    for (const name of ['PGHOST', 'PGOPTIONS', 'PGDATABASE', 'pgservice'])
      assert.deepEqual(codes({ ...GOOD, [name]: 'x' }), ['pg-env'], name);
    assert.deepEqual(codes({}), ['node-env', 'rp-id', 'database-url']);
  });

  it('EVM-077 AC4/AC2: messages name the problem and the fix and never contain a value', () => {
    const env = { ...GOOD, DATABASE_URL: 'postgres://zzuser:zzsecret@db.example.com:5442/evia_dev?host=zzhost', PGPASSWORD: 'zzpass' };
    const text = guardProblems(env)
      .map((problem) => problem.message)
      .join('\n');
    assert.match(text, /DATABASE_URL/);
    for (const secret of ['zzuser', 'zzsecret', 'zzhost', 'zzpass']) assert.ok(!text.includes(secret), secret);
    assert.ok(databaseUrlProblems('postgres://u:p@localhost:5442/evia').every((problem) => problem.message.includes('Popraw')));
  });
});

describe('EVM-077 AC2: the .env reader', () => {
  it('reads names and values, quotes and comments, and ignores everything else', () => {
    const values = parseDotenv(
      '# comment\nA=1\n B = two words \nC="quoted # kept"\nD=\'single\'\nE=value # trailing\n1BAD=x\nnonsense\r\nF=\r\n',
    );
    assert.deepEqual(values, { A: '1', B: 'two words', C: 'quoted # kept', D: 'single', E: 'value', F: '' });
  });
});

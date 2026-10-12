import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Database } from '../../src/platform/database/database.ts';
import { requirePreCommitRegistry, runInTransaction, type PreCommitParticipant } from '../../src/platform/database/transactional.ts';

/** A fake database: `transaction()` runs the callback with a marker transaction and records commit or rollback. */
function fakeDatabase() {
  const log: string[] = [];
  const tx = { marker: 'tx' } as unknown as Kysely<Database>;
  const db = {
    transaction: () => {
      const builder = {
        setIsolationLevel: (level: string) => {
          log.push(`isolation:${level}`);
          return builder;
        },
        execute: async <T>(work: (transaction: Kysely<Database>) => Promise<T>): Promise<T> => {
          try {
            const result = await work(tx);
            log.push('commit');
            return result;
          } catch (error) {
            log.push('rollback');
            throw error;
          }
        },
      };
      return builder;
    },
  } as unknown as Kysely<Database>;
  return { db, tx, log };
}

const participant = (key: symbol, log: string[], name: string): PreCommitParticipant<string[]> => ({
  key,
  create: () => [],
  run: (state) => {
    log.push(`${name}:${state.join(',')}`);
    return Promise.resolve();
  },
});

describe('the transaction of the API with a pre-commit registry (EVM-034; ADR-0017)', () => {
  it('EVM-034 the pre-commit action runs after the unit of work and before the commit, once, with the state enlisted', async () => {
    const { db, log } = fakeDatabase();
    const overview = participant(Symbol('overview'), log, 'overview');
    const result = await runInTransaction(db, (tx) => {
      const state = requirePreCommitRegistry(tx).enlist(overview);
      state.push('a');
      log.push('work');
      requirePreCommitRegistry(tx).enlist(overview).push('b');
      return Promise.resolve(42);
    });
    expect(result).toBe(42);
    expect(log).toEqual(['work', 'overview:a,b', 'commit']);
  });

  it('EVM-034 the participants run in the order of their first enlistment', async () => {
    const { db, log } = fakeDatabase();
    const first = participant(Symbol('first'), log, 'first');
    const second = participant(Symbol('second'), log, 'second');
    await runInTransaction(db, (tx) => {
      requirePreCommitRegistry(tx).enlist(second);
      requirePreCommitRegistry(tx).enlist(first);
      return Promise.resolve();
    });
    expect(log).toEqual(['second:', 'first:', 'commit']);
  });

  it('EVM-034 an error of the unit of work rolls back and runs no pre-commit action', async () => {
    const { db, log } = fakeDatabase();
    const overview = participant(Symbol('overview'), log, 'overview');
    await expect(
      runInTransaction(db, (tx) => {
        requirePreCommitRegistry(tx).enlist(overview);
        return Promise.reject(new Error('boom'));
      }),
    ).rejects.toThrow('boom');
    expect(log).toEqual(['rollback']);
  });

  it('EVM-034 an error of the pre-commit action rolls the change back (the command and the projection are one unit)', async () => {
    const { db, log } = fakeDatabase();
    const failing: PreCommitParticipant<null> = {
      key: Symbol('failing'),
      create: () => null,
      run: () => Promise.reject(new Error('recompute failed')),
    };
    await expect(
      runInTransaction(db, (tx) => {
        requirePreCommitRegistry(tx).enlist(failing);
        log.push('work');
        return Promise.resolve();
      }),
    ).rejects.toThrow('recompute failed');
    expect(log).toEqual(['work', 'rollback']);
  });

  it('EVM-034 a transaction that was not opened through runInTransaction has no registry: fail closed, never a silent skip', () => {
    const plain = { marker: 'opened by a plain db.transaction()' } as unknown as Kysely<Database>;
    expect(() => requirePreCommitRegistry(plain)).toThrow(/runInTransaction/);
  });

  it('EVM-034 the isolation level is passed to the transaction', async () => {
    const { db, log } = fakeDatabase();
    await runInTransaction(db, () => Promise.resolve(), { isolationLevel: 'repeatable read' });
    expect(log).toEqual(['isolation:repeatable read', 'commit']);
  });
});

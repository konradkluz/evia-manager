/**
 * Argon2id password hashing (ADR-0005; SR-AUTH-04, ASVS V6.2.1 note, V11.4.2): OWASP baseline of 19 MiB, 2 passes,
 * one lane. The asynchronous API runs on the libuv thread pool and never blocks the event loop; the PHC string carries
 * its own random salt and parameters (so the parameters can be raised later and old hashes still verify).
 */
import { hash } from '@node-rs/argon2';
import type { PasswordHasher } from './ports.ts';

export const ARGON2_PARAMETERS = Object.freeze({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });

/** `Algorithm.Argon2id` of the binding (an ambient const enum cannot be imported under type stripping). */
const ARGON2ID = 2;

export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- ambient const enum of the binding: 2 is Algorithm.Argon2id
    return hash(password, { ...ARGON2_PARAMETERS, algorithm: ARGON2ID });
  }
}

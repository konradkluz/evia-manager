/**
 * The keys of the counters against guessing (EVM-026 AC1; SR-AUTH-05, SR-CRYPTO; ASVS V11): HMAC-SHA-256 under a key of the server, so the table holds
 * neither an e-mail address nor a plain hash of one (a plain hash of an address is a lookup table for a leaked database). Each kind of key has its own
 * label and the input is length-unambiguous (a label, a NUL, the value): the key of an account can never equal the key of a browser.
 *
 * The address is normalised by the same function as the lookup of the account (`normalizeEmail`), so a different case, spaces around it or another
 * Unicode form of the same address are ONE counter.
 */
import { createHmac } from 'node:crypto';
import { normalizeEmail } from './text.ts';

const hmac = (key: Buffer, label: string, value: string): Buffer => createHmac('sha256', key).update(`${label}\0${value}`, 'utf8').digest();

/** The counter of an account for the browsers it does not know (and the only counter of an address that has no account). */
export const accountKey = (key: Buffer, email: string): Buffer => hmac(key, 'acct', normalizeEmail(email));

/** The counter of one browser the account knows (the identifier of its row in `browser_devices`). */
export const browserKey = (key: Buffer, deviceId: string): Buffer => hmac(key, 'dev', deviceId);

/** The one shared counter of the alert about a flood of failed passwords. */
export const spikeKey = (key: Buffer): Buffer => hmac(key, 'spike', 'password');

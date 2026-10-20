/**
 * The register of the browsers an account signed in from (EVM-026 AC5; SR-AUTH-15): the cookie `__Host-evia_device` names a browser, the database keeps the
 * SHA-256 of its 256-bit token, the account and two dates — no user agent, no address, no place. The cookie is NOT a credential: it does not authenticate
 * and it never skips the second step; it only says "this account has signed in from here before". Two uses:
 *
 * - at the FIRST step (`known`): a cookie that belongs to the account being signed in to names a browser it knows, which has its own counter against
 *   guessing. A cookie of ANOTHER account, a malformed or a doubled one is no cookie at all — otherwise a colleague with an account of his own would make
 *   as many browsers as he likes and get a fresh budget of tries against the owner (M5).
 * - after a FULL sign-in (`remember`): the token is replaced by a new one (the browser keeps its identifier, so its counter stays); a browser the account did not
 *   know is added, the owner gets e-mail 7, and for an Administrator's account every Administrator gets the alert 9.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { enqueueEmail } from '../../../platform/email/email-outbox.ts';
import { DATABASE } from '../../../platform/tokens.ts';
import { MAX_BROWSERS_PER_USER } from '../domain/constants.ts';
import { hashToken, newToken } from '../domain/tokens.ts';
import { findUserById, listActiveAdministratorIds } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import {
  findBrowserOfUser,
  insertBrowser,
  rotateBrowser,
  trimBrowsers,
  type BrowserDeviceRecord,
} from '../infrastructure/throttle-queries.ts';
import { LoginThrottle } from './login-throttle.ts';

export interface RememberedBrowser {
  /** The new cookie token — the only moment it exists in the clear; the response puts it in `Set-Cookie`. */
  readonly deviceToken: string;
  readonly known: boolean;
}

@Injectable()
export class BrowserRegister {
  readonly #db: Kysely<Database>;
  readonly #throttle: LoginThrottle;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(LoginThrottle) throttle: LoginThrottle) {
    this.#db = db;
    this.#throttle = throttle;
  }

  /** The browser of the cookie when it is one THIS account knows. */
  async known(userId: string, deviceToken: string | undefined): Promise<BrowserDeviceRecord | undefined> {
    if (deviceToken === undefined) return undefined;
    return findBrowserOfUser(identityTables(this.#db), userId, hashToken(deviceToken));
  }

  /** A full sign-in of the account has just succeeded (in the transaction that starts the session). */
  async remember(tx: Kysely<Database>, userId: string, presentedToken: string | undefined, now: Date): Promise<RememberedBrowser> {
    const db = identityTables(tx);
    const deviceToken = newToken();
    const tokenSha256 = hashToken(deviceToken);
    // The row is locked: of two parallel sign-ins with one cookie the second finds a changed token — an unknown browser, a new row.
    const known = presentedToken === undefined ? undefined : await findBrowserOfUser(db, userId, hashToken(presentedToken), true);
    if (known !== undefined) {
      await rotateBrowser(db, known.id, tokenSha256, now);
      return { deviceToken, known: true };
    }
    await insertBrowser(db, userId, tokenSha256, now);
    await this.#throttle.dropBrowserCounters(tx, await trimBrowsers(db, userId, MAX_BROWSERS_PER_USER));
    await enqueueEmail(tx, { kind: 'new_browser', variant: null, recipientUserId: userId, now });
    const user = await findUserById(db, userId);
    if (user?.role === 'administrator') {
      for (const recipientUserId of await listActiveAdministratorIds(db)) {
        await enqueueEmail(tx, { kind: 'administrator_alert', variant: 'administrator_new_browser', recipientUserId, now });
      }
    }
    return { deviceToken, known: false };
  }
}

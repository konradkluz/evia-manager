/**
 * The session record of the secure store (EVM-100; security W10, architect 6): the minimum the app needs after a restart — who is
 * signed in (to open the owner's store), the display name and the role FOR THE UI ONLY (never for authorisation; the server decides),
 * and two clock checkpoints in the frame of the server: the start of the session and the last successful contact. No e-mail, no token.
 * Written LAST in a sign-in: it is the commit marker — a session exists only when this record and the refresh token are both there.
 */
import { evaluateContact, parseContactRecord, type ContactRecord } from '@evia/sync-core';
import type { SessionClock, UserRole } from './ports';

export interface SessionMeta {
  readonly v: 1;
  readonly userId: string;
  readonly displayName: string;
  readonly role: UserRole;
  /** Checkpoint at the sign-in (`serverTime` of the answer). */
  readonly started: ContactRecord;
  /** Checkpoint at the last successful sign-in or refresh. */
  readonly lastContact: ContactRecord;
}

const ROLES: readonly UserRole[] = ['administrator', 'editor', 'read_only'];

export function checkpoint(serverTime: number, clock: SessionClock): ContactRecord {
  const wall = clock.now();
  return {
    v: 1,
    serverTime,
    offset: serverTime - wall,
    bootId: clock.bootId(),
    mono: clock.monotonicNow(),
    wall,
    carried: 0,
    maxObservedWall: wall,
  };
}

export function parseSessionMeta(text: string | null): SessionMeta | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const started = parseContactRecord(r['started']);
  const lastContact = parseContactRecord(r['lastContact']);
  const { userId, displayName, role } = r;
  if (r['v'] !== 1 || typeof userId !== 'string' || userId.length < 1 || userId.length > 64) return null;
  if (typeof displayName !== 'string' || displayName.length > 200) return null;
  const knownRole = ROLES.find((candidate) => candidate === role);
  if (knownRole === undefined || started === null || lastContact === null) return null;
  return { v: 1, userId, displayName, role: knownRole, started, lastContact };
}

const DAY_MS = 86_400_000;
/** Server limits of the mobile session (EVM-094): 14 days without activity, 30 days in total. */
export const IDLE_LIMIT_MS = 14 * DAY_MS;
export const AGE_LIMIT_MS = 30 * DAY_MS;

/**
 * "Sesja wygasła" or "Wylogowano ten telefon" for a `401 session_revoked` met while REFRESHING (AC4, story decisions). A reason sent by
 * the server would win (`serverReason`; the contract has none yet — EVM-107), otherwise the fallback rule: last contact older than 14
 * days or session older than 30 days, measured by the clock checkpoints (a clock set back counts as "not expired"). Never the phone's
 * wall clock alone.
 */
export function sessionEndVariant(
  meta: SessionMeta | null,
  clock: SessionClock,
  serverReason?: 'expired' | 'revoked',
): 'session_expired' | 'session_revoked' {
  if (serverReason !== undefined) return serverReason === 'expired' ? 'session_expired' : 'session_revoked';
  if (meta === null) return 'session_revoked';
  const reading = { wall: clock.now(), mono: clock.monotonicNow(), bootId: clock.bootId() };
  const idle = evaluateContact(meta.lastContact, reading);
  const age = evaluateContact(meta.started, reading);
  return (idle.ok && idle.elapsedMs > IDLE_LIMIT_MS) || (age.ok && age.elapsedMs > AGE_LIMIT_MS) ? 'session_expired' : 'session_revoked';
}

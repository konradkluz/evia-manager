import { describe, expect, it } from 'vitest';
import { parseChange, parseClientConfig, parsePage, parseSnapshotEntity, PROJECTIONS } from '../src/pull-parse.ts';
import { ENTITY_TYPES, type EntityType } from '../src/pull-types.ts';
import { SERVER_NOW, cur, del, iso, uid, upsert, wireEntity } from './pull-helpers.ts';

describe('reader of server data (EVM-092 AC6)', () => {
  it('EVM-092 AC6: every projection of the contract is read field by field and keeps exactly the listed fields', () => {
    for (const type of ENTITY_TYPES) {
      const parsed = parseChange(upsert(type, 1, 3));
      expect(parsed.kind, type).toBe('upsert');
      if (parsed.kind !== 'upsert') continue;
      expect(Object.keys(parsed.entity.fields).sort()).toEqual(Object.keys(PROJECTIONS[type]).sort());
      expect(parsed.entity.version).toBe(3);
    }
  });

  it('EVM-092 AC6: a field outside the projection (e-mail, tax id, notes, payments) is dropped by the default tolerant reader and is projection_mismatch only in strict mode', () => {
    const extras: [EntityType, string][] = [
      ['customer', 'email'],
      ['customer', 'nip'],
      ['party', 'notes'],
      ['work_order', 'paymentMilestones'],
      ['user', 'role'],
    ];
    for (const [type, field] of extras) {
      expect(parseChange(upsert(type, 1, 1, { [field]: 'synthetic' }), { strict: true }), `${type}.${field}`).toEqual({
        kind: 'invalid',
        reason: 'projection_mismatch',
        type,
      });
      const tolerant = parseChange(upsert(type, 1, 1, { [field]: 'synthetic' }));
      expect(tolerant.kind).toBe('upsert');
      expect(JSON.stringify(tolerant)).not.toContain('synthetic');
    }
  });

  it('EVM-092 AC6: prototype pollution keys are rejected in both modes and never copied', () => {
    const polluted = JSON.parse(
      '{"op":"upsert","entity":{"__proto__":{"polluted":true},"type":"user","id":"90000000-0000-4000-8000-000000000001","version":1,"displayName":"x"}}',
    ) as unknown;
    for (const strict of [true, false]) {
      expect(parseChange(polluted, { strict })).toEqual({ kind: 'invalid', reason: 'projection_mismatch', type: 'user' });
    }
    for (const key of ['constructor', 'prototype']) {
      expect(parseChange(upsert('user', 1, 1, { [key]: {} }), { strict: false }).kind).toBe('invalid');
    }
    const scope = JSON.parse(`{"op":"upsert","entity":${JSON.stringify(wireEntity('scope_item', 1, 1))}}`) as {
      entity: { parameters: unknown };
    };
    scope.entity.parameters = JSON.parse('{"__proto__":"x"}');
    expect(parseChange(scope).kind).toBe('invalid');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('EVM-092 AC6: ids must be UUIDs, versions integers from 1 to MAX_SAFE_INTEGER', () => {
    const bad = [
      { id: 'not-a-uuid' },
      { id: '../../x' },
      { id: `${uid('user', 1)}/x` },
      { version: 0 },
      { version: 1.5 },
      { version: -1 },
      { version: Number.MAX_SAFE_INTEGER + 1 },
      { version: '1' },
      { version: null },
    ];
    for (const extra of bad) expect(parseChange(upsert('user', 1, 1, extra)).kind, JSON.stringify(extra)).toBe('invalid');
    expect(parseChange(upsert('user', 1, Number.MAX_SAFE_INTEGER)).kind).toBe('upsert');
  });

  it('EVM-092 AC6: limits of lengths, ranges, dates and the parameters object are checked', () => {
    const cases: [EntityType, Record<string, unknown>][] = [
      ['customer', { displayName: 'x'.repeat(402) }],
      ['customer', { phone: 12 }],
      ['customer', { kind: '' }],
      ['customer', { kind: 'x'.repeat(65) }],
      ['work_order', { createdAt: 'yesterday' }],
      ['work_order', { plannedDate: '2026-1-1' }],
      ['work_order', { title: null }],
      ['work_order', { closedAt: 5 }],
      ['site', { connectionPowerKw: 1001 }],
      ['site', { connectionPowerKw: Number.NaN }],
      ['site', { managerPartyId: 'x' }],
      ['scope_item', { position: 51 }],
      ['scope_item', { quantity: 0 }],
      ['scope_item', { parameters: null }],
      ['scope_item', { parameters: [] }],
      ['scope_item', { parameters: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, 1])) }],
      ['scope_item', { parameters: { k: 'x'.repeat(201) } }],
      ['scope_item', { parameters: { k: { nested: 1 } } }],
      ['scope_item', { parameters: { k: Number.POSITIVE_INFINITY } }],
      ['scope_item', { parameters: { ['x'.repeat(65)]: 1 } }],
      ['media_asset', { sizeBytes: -1 }],
      ['media_asset', { widthPx: 1.5 }],
    ];
    for (const [type, extra] of cases)
      expect(parseChange(upsert(type, 1, 1, extra)).kind, `${type} ${JSON.stringify(extra).slice(0, 40)}`).toBe('invalid');
    expect(parseChange(upsert('scope_item', 1, 1, { parameters: { a: 'x', b: 2, c: true } })).kind).toBe('upsert');
  });

  it('EVM-092 AC6: a missing field of the projection is projection_mismatch', () => {
    const entity = wireEntity('customer', 1, 1);
    delete entity['phone'];
    expect(parseChange({ op: 'upsert', entity })).toEqual({ kind: 'invalid', reason: 'projection_mismatch', type: 'customer' });
  });

  it('EVM-092 AC6: a malformed envelope is "malformed" with the unknown type; the report has no content', () => {
    const malformed = [
      null,
      'x',
      7,
      [],
      {},
      { op: 'patch' },
      { op: 'upsert' },
      { op: 'upsert', entity: 'x' },
      { op: 'upsert', entity: {} },
      { op: 'upsert', entity: { type: 'x'.repeat(65) } },
      { op: 'delete' },
      { op: 'delete', type: 'user', id: 'x' },
      { op: 'delete', type: 'user', id: uid('user', 1), version: 0 },
      { op: 'delete', type: 'x'.repeat(65), id: uid('user', 1) },
    ];
    for (const raw of malformed)
      expect(parseChange(raw), JSON.stringify(raw)).toEqual({ kind: 'invalid', reason: 'malformed', type: 'unknown' });
  });

  it('EVM-092 AC6: an extra field in the envelope or in a delete is ignored by the default (tolerant) reader and invalid only in strict mode', () => {
    const withExtra = [
      { op: 'upsert', extra: 1, entity: wireEntity('user', 1, 1) },
      { op: 'delete', type: 'user', id: uid('user', 1), extra: 1 },
    ];
    for (const raw of withExtra) {
      expect(parseChange(raw).kind, JSON.stringify(raw)).not.toBe('invalid');
      expect(JSON.stringify(parseChange(raw))).not.toContain('extra');
      expect(parseChange(raw, { strict: true }), JSON.stringify(raw)).toEqual({ kind: 'invalid', reason: 'malformed', type: 'unknown' });
    }
  });

  it('EVM-092 AC6: an unknown type is "unknown" (upsert and delete), a delete may carry a version', () => {
    expect(parseChange({ op: 'upsert', entity: { type: 'hologram', id: 'x', version: 1 } })).toEqual({ kind: 'unknown' });
    expect(parseChange({ op: 'delete', type: 'hologram', id: uid('user', 1) })).toEqual({ kind: 'unknown' });
    expect(parseChange({ op: 'upsert', entity: { type: '__proto__' } })).toEqual({ kind: 'unknown' });
    expect(parseChange(del('user', 1, 4))).toEqual({ kind: 'delete', type: 'user', id: uid('user', 1), version: 4 });
    expect(parseChange(del('user', 1))).toEqual({ kind: 'delete', type: 'user', id: uid('user', 1) });
  });

  it('EVM-092 AC6: a snapshot entity is read like a change; anything else is invalid', () => {
    expect(parseSnapshotEntity(wireEntity('user', 1, 1)).kind).toBe('upsert');
    expect(parseSnapshotEntity('x').kind).toBe('invalid');
  });

  it('EVM-092 AC6: the page checks shape, size, phase, cursor and time; unknown reasons become periodic', () => {
    const ok = { result: 'changes', phase: 'snapshot', changes: [], cursor: cur(1), hasMore: true, serverTime: iso(SERVER_NOW) };
    expect(parsePage(ok, 200)).toMatchObject({ ok: true, page: { phase: 'snapshot', hasMore: true, serverTime: SERVER_NOW } });
    expect(parsePage({ ...ok, serverTime: '2026-10-29T08:00:00+02:00' }, 200)).toMatchObject({ ok: true });
    expect(parsePage({ ...ok, changes: new Array(3).fill(1) }, 2)).toEqual({ ok: false });
    expect(parsePage({ ...ok, changes: new Array(600).fill(1) }, 900)).toEqual({ ok: false });
    expect(parsePage({ ...ok, cursor: 'a'.repeat(1025) }, 200)).toEqual({ ok: false });
    expect(parsePage({ ...ok, cursor: 'bad cursor with spaces' }, 200)).toEqual({ ok: false });
    expect(parsePage({ ...ok, serverTime: '2026-13-45T99:99:99Z' }, 200)).toEqual({ ok: false });
    expect(parsePage({ result: 'resync_required', reason: 'cursor_expired', serverTime: iso(SERVER_NOW) }, 200)).toMatchObject({
      resync: { reason: 'cursor_expired' },
    });
    expect(parsePage({ result: 'resync_required', reason: 'invalid_change', serverTime: iso(SERVER_NOW) }, 200)).toMatchObject({
      resync: { reason: 'periodic' },
    });
    expect(parsePage({ result: 'resync_required', reason: 'x'.repeat(33), serverTime: iso(SERVER_NOW) }, 200)).toEqual({ ok: false });
  });

  it('EVM-092 AC7: the client configuration is validated like server data; defaults for anything out of range', () => {
    expect(
      parseClientConfig({ offlineContactWindowDays: 3, closedWorkOrdersInScopeDays: 45, periodicResyncDays: 14, scopeRuleVersion: 12 }),
    ).toEqual({
      offlineContactWindowDays: 3,
      closedWorkOrdersInScopeDays: 45,
      periodicResyncDays: 14,
      scopeRuleVersion: '12',
    });
    const d = { offlineContactWindowDays: 7, closedWorkOrdersInScopeDays: 30, periodicResyncDays: 7, scopeRuleVersion: '' };
    expect(parseClientConfig(null)).toEqual(d);
    expect(parseClientConfig([])).toEqual(d);
    expect(
      parseClientConfig({ offlineContactWindowDays: 0, closedWorkOrdersInScopeDays: 366, periodicResyncDays: 91, scopeRuleVersion: 'a b' }),
    ).toEqual(d);
    expect(parseClientConfig({ offlineContactWindowDays: 8 }).offlineContactWindowDays).toBe(7);
    expect(parseClientConfig({ offlineContactWindowDays: '3', closedWorkOrdersInScopeDays: 2.5, scopeRuleVersion: -1 })).toEqual(d);
    expect(parseClientConfig({ scopeRuleVersion: 'v-1.2' }).scopeRuleVersion).toBe('v-1.2');
  });
});

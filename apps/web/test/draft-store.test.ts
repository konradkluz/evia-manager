import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts, discardDraft, readDraft, reconcileDrafts, saveDraft } from '../src/session/draft-store.ts';

const ANNA = '11111111-1111-4111-8111-111111111111';
const JAN = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  clearDrafts();
  vi.unstubAllGlobals();
});

describe('drafts in the memory of the tab (EVM-067 AC6; SR-WEB-05)', () => {
  it('EVM-067 AC6 the same person logging in again in the tab gets the draft back', () => {
    saveDraft(ANNA, 'work-order', 'Adres: ulica Testowa 1');
    reconcileDrafts(ANNA);
    expect(readDraft(ANNA, 'work-order')).toBe('Adres: ulica Testowa 1');
  });

  it('EVM-067 AC6 another person logging in gets no draft and the draft is gone for good', () => {
    saveDraft(ANNA, 'work-order', 'Adres: ulica Testowa 1');
    reconcileDrafts(JAN);
    expect(readDraft(JAN, 'work-order')).toBeUndefined();
    expect(readDraft(ANNA, 'work-order')).toBeUndefined();
  });

  it('EVM-067 AC6 a draft is only read by its owner, and a new owner replaces the old one', () => {
    saveDraft(ANNA, 'work-order', 'a');
    expect(readDraft(JAN, 'work-order')).toBeUndefined();
    saveDraft(JAN, 'note', 'b');
    expect(readDraft(ANNA, 'work-order')).toBeUndefined();
    expect(readDraft(JAN, 'note')).toBe('b');
    discardDraft('note');
    expect(readDraft(JAN, 'note')).toBeUndefined();
  });

  it('EVM-067 AC6 logging out discards every draft', () => {
    saveDraft(ANNA, 'work-order', 'a');
    clearDrafts();
    reconcileDrafts(ANNA);
    expect(readDraft(ANNA, 'work-order')).toBeUndefined();
  });

  it('EVM-067 AC6 the store never touches the storages of the browser', () => {
    const touched = vi.fn();
    const spy = { getItem: touched, setItem: touched, removeItem: touched, clear: touched, key: touched, length: 0 };
    vi.stubGlobal('localStorage', spy);
    vi.stubGlobal('sessionStorage', spy);
    saveDraft(ANNA, 'work-order', 'a');
    reconcileDrafts(ANNA);
    readDraft(ANNA, 'work-order');
    clearDrafts();
    expect(touched).not.toHaveBeenCalled();
  });
});

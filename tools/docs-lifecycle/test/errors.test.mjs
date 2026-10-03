// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { check, errorMessage, ToolError } from '../lib/errors.mjs';

describe('błędy narzędzia (EVM-012)', () => {
  it('EVM-012 AC3: check zgłasza ToolError z komunikatem tylko przy niespełnionym warunku', () => {
    assert.doesNotThrow(() => check(true, 'nie powinno się zdarzyć'));
    assert.throws(() => check(false, 'opis błędu'), { name: 'ToolError', message: 'opis błędu' });
    assert.ok(new ToolError('x') instanceof Error);
  });

  it('EVM-012 AC3: errorMessage obsługuje błędy i inne wartości', () => {
    assert.equal(errorMessage(new Error('awaria')), 'awaria');
    assert.equal(errorMessage('tekst'), 'tekst');
  });
});

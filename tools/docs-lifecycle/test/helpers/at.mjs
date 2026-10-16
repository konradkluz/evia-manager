// @ts-check
import assert from 'node:assert/strict';

/**
 * Element of a list that the test expects to exist — a failed expectation names the index (`noUncheckedIndexedAccess`).
 * @template T
 * @param {ArrayLike<T>} items
 * @param {number} index
 * @returns {T}
 */
export function at(items, index) {
  const item = items[index];
  assert.notEqual(item, undefined, `brak elementu o indeksie ${index} (długość listy: ${items.length})`);
  return /** @type {T} */ (item);
}

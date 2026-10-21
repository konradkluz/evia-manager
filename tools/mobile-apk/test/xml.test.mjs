import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { childrenNamed, parseXml } from '../src/xml.mjs';

describe('XML reader for apkanalyzer output (EVM-009 AC6)', () => {
  it('EVM-009 AC6: reads elements, attributes, self-closing tags and skips the declaration and comments', () => {
    const root = parseXml(
      '<?xml version="1.0" encoding="utf-8"?>\r\n<!-- note -->\r\n<a x="1"\r\n   y="&lt;&amp;&quot;">\r\n  <b />\r\n  <b z="2"></b>\r\n  <c/>\r\n</a>\r\n',
    );
    assert.equal(root.name, 'a');
    assert.deepEqual(root.attributes, { x: '1', y: '<&"' });
    assert.deepEqual(
      root.children.map((child) => child.name),
      ['b', 'b', 'c'],
    );
    assert.equal(childrenNamed(root, 'b').length, 2);
    assert.deepEqual(childrenNamed(root, 'b')[1]?.attributes, { z: '2' });
    assert.deepEqual(childrenNamed(root, 'missing'), []);
  });

  it('EVM-009 AC6: unbalanced, empty or multi-root documents throw instead of passing quietly', () => {
    assert.throws(() => parseXml('<a><b></a>'), /unbalanced/);
    assert.throws(() => parseXml('<a>'), /no complete root/);
    assert.throws(() => parseXml(''), /no complete root/);
    assert.throws(() => parseXml('<a/><b/>'), /more than one root/);
    assert.throws(() => parseXml('text<a/>'), /outside the root/);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { collectTokens, loadTokenFiles, validateTokens } from '../src/model.ts';
import { fixture, type Fixture, hex, px, VALID } from './helpers.ts';

let current: Fixture | undefined;
afterEach(() => {
  current?.dispose();
  current = undefined;
});

/** Loads, collects and validates a fixture; returns the validation errors. */
function errorsOf(files: Record<string, unknown>): string[] {
  current = fixture(files);
  const collected = collectTokens(loadTokenFiles(current.dir));
  return [...collected.errors, ...validateTokens(collected.tokens)];
}

describe('token model and validation (EVM-006 AC6)', () => {
  it('EVM-006 AC6: a valid set has no errors; types are inherited from groups; layers come from the directory', () => {
    current = fixture(VALID);
    const { tokens, errors } = collectTokens(loadTokenFiles(current.dir));
    expect(errors).toEqual([]);
    expect(validateTokens(tokens)).toEqual([]);
    expect(tokens.get('space.md')).toMatchObject({ type: 'dimension', layer: 'semantic', deprecated: false });
    expect(tokens.get('palette.teal.600')).toMatchObject({ type: 'color', layer: 'base' });
  });

  it('EVM-006 AC6: $deprecated marks the token, and a deprecated group marks all its tokens', () => {
    current = fixture(VALID);
    const { tokens } = collectTokens(loadTokenFiles(current.dir));
    expect(tokens.get('color.old')?.deprecated).toBe(true);
    expect(tokens.get('color.retired.bg')?.deprecated).toBe(true);
    expect(tokens.get('color.brand')?.deprecated).toBe(false);
  });

  it('EVM-006 AC6: invalid JSON is reported with the file name', () => {
    expect(errorsOf({ ...VALID, 'base/broken.tokens.json': '{ not json' })).toEqual([
      expect.stringMatching(/^base\/broken\.tokens\.json: invalid JSON/),
    ]);
  });

  it('EVM-006 AC6: a token file must contain a JSON object', () => {
    expect(errorsOf({ ...VALID, 'base/list.tokens.json': '[1, 2]' })).toEqual([
      'base/list.tokens.json: the file must contain a JSON object',
    ]);
  });

  it('EVM-006 AC6: a token without $type (no type on the token or any parent group) is an error', () => {
    expect(errorsOf({ ...VALID, 'base/x.tokens.json': { misc: { a: { $value: 1 } } } })).toEqual([
      'base/x.tokens.json: misc.a — missing $type (on the token or a parent group)',
    ]);
  });

  it('EVM-006 AC6: an unresolvable alias is an error', () => {
    const files = { ...VALID, 'semantic/extra.tokens.json': { space: { lg: { $type: 'dimension', $value: '{dimension.99}' } } } };
    expect(errorsOf(files)).toEqual(['semantic/extra.tokens.json: space.lg — alias {dimension.99} does not resolve']);
  });

  it('EVM-006 AC6: alias cycles are detected', () => {
    const files = {
      ...VALID,
      'base/cycle.tokens.json': {
        loop: { $type: 'number', a: { $value: '{loop.b}' }, b: { $value: '{loop.c}' }, c: { $value: '{loop.a}' } },
      },
    };
    expect(errorsOf(files)).toEqual(['base/cycle.tokens.json: loop.a — alias cycle loop.a → loop.b → loop.c → loop.a']);
  });

  it('EVM-006 AC6: a literal in semantic/ is an error (semantic tokens are aliases only), also inside composite values', () => {
    const files = {
      ...VALID,
      'semantic/literal.tokens.json': {
        layer: { $type: 'number', top: { $value: 500 } },
        motion: {
          $type: 'transition',
          hover: { $value: { duration: { value: 100, unit: 'ms' }, delay: '{duration.0}', timingFunction: [0, 0, 1, 1] } },
        },
      },
    };
    expect(errorsOf(files)).toEqual([
      'semantic/literal.tokens.json: layer.top — literal value in semantic/ (use an alias to a base token)',
      'semantic/literal.tokens.json: motion.hover — literal value in semantic/ (use an alias to a base token)',
      'semantic/literal.tokens.json: motion.hover — alias {duration.0} does not resolve',
    ]);
  });

  it('EVM-006 AC6: semantic tokens never reference other semantic tokens', () => {
    const files = { ...VALID, 'semantic/chain.tokens.json': { space: { lg: { $type: 'dimension', $value: '{space.md}' } } } };
    expect(errorsOf(files)).toEqual([
      'semantic/chain.tokens.json: space.lg — alias {space.md} points to a semantic token (only base/ allowed)',
    ]);
  });

  it('EVM-006 AC6: the alias type must match the token type, also for parts of composite values', () => {
    const files = {
      ...VALID,
      'base/font.tokens.json': {
        font: { size: { $type: 'dimension', '16': { $value: px(16) } }, family: { $type: 'fontFamily', sans: { $value: ['Inter'] } } },
      },
      'semantic/mixed.tokens.json': {
        radius: { card: { $type: 'dimension', $value: '{palette.teal.600}' } },
        text: {
          $type: 'typography',
          body: {
            $value: {
              fontFamily: '{font.family.sans}',
              fontSize: '{palette.alpha.black-12}',
              fontWeight: '{dimension.8}',
              letterSpacing: '{dimension.8}',
              lineHeight: '{dimension.8}',
            },
          },
        },
      },
    };
    expect(errorsOf(files)).toEqual([
      'semantic/mixed.tokens.json: radius.card — alias {palette.teal.600} has type color, expected dimension',
      'semantic/mixed.tokens.json: text.body — alias {palette.alpha.black-12} has type color, expected dimension (fontSize)',
      'semantic/mixed.tokens.json: text.body — alias {dimension.8} has type dimension, expected fontWeight (fontWeight)',
      'semantic/mixed.tokens.json: text.body — alias {dimension.8} has type dimension, expected number (lineHeight)',
    ]);
  });

  it('EVM-006 AC6: $deprecated accepts only true, false or text — on tokens and on groups', () => {
    const files = {
      ...VALID,
      'base/dep.tokens.json': { weird: { $type: 'number', $deprecated: 1, a: { $value: 1 }, b: { $value: 2, $deprecated: null } } },
    };
    expect(errorsOf(files)).toEqual([
      'base/dep.tokens.json: weird — $deprecated must be true, false or text',
      'base/dep.tokens.json: weird.b — $deprecated must be true, false or text',
    ]);
  });

  it('EVM-006 AC6: the same token path in two files is an error (all files merge into one tree)', () => {
    const files = { ...VALID, 'semantic/zz-dup.tokens.json': { space: { md: { $type: 'dimension', $value: '{dimension.8}' } } } };
    expect(errorsOf(files)).toEqual(['semantic/zz-dup.tokens.json: space.md — defined again (first in semantic/size.tokens.json)']);
  });

  it('EVM-006 AC6: only *.tokens.json in base/ and semantic/ are read, in a stable order', () => {
    current = fixture({ ...VALID, 'README.md': '# x', 'semantic/notes.json': '{}', 'other/x.tokens.json': '{}' });
    expect(loadTokenFiles(current.dir).map((file) => file.name)).toEqual([
      'base/color.tokens.json',
      'base/dimension.tokens.json',
      'semantic/color.light.tokens.json',
      'semantic/size.tokens.json',
    ]);
  });

  it('EVM-006 AC6: color objects keep alpha; composite values resolve nested aliases', () => {
    current = fixture({
      ...VALID,
      'base/shadow.tokens.json': {
        shadow: {
          $type: 'shadow',
          '1': { $value: { color: '{palette.alpha.black-12}', offsetX: px(0), offsetY: px(1), blur: px(3), spread: px(0) } },
        },
      },
    });
    const { tokens } = collectTokens(loadTokenFiles(current.dir));
    expect(validateTokens(tokens)).toEqual([]);
    expect(tokens.get('palette.alpha.black-12')?.value).toEqual(hex('#000000', 0.12));
  });
});

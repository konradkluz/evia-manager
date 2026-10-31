import globals from 'globals';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { config, PORTABLE_CORE_FILES, portableCore } from '../src/eslint.ts';

/** Lints a snippet with the portable-core block only (no type information needed). */
function lint(code: string, filename = 'src/engine.js'): string[] {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    code,
    [
      { files: ['**/*.js'], languageOptions: { sourceType: 'module', globals: { ...globals.node } } },
      ...portableCore({ files: ['**/*.js'] }),
    ],
    filename,
  );
  return messages.map((message) => message.ruleId ?? message.message);
}

describe('portable core boundaries (EVM-091; architect 1, security 6 and 11)', () => {
  it('EVM-091 AC1: Node built-ins, React Native, Expo, the contract and Zod cannot be imported by the sync core', () => {
    const forbidden = [
      "import fs from 'node:fs';",
      "import { randomUUID } from 'node:crypto';",
      "import { createHash } from 'crypto';",
      "import path from 'path';",
      "import { Buffer } from 'buffer';",
      "import { View } from 'react-native';",
      "import * as SecureStore from 'expo-secure-store';",
      "import Constants from 'expo/config';",
      "import { zSyncMutationsRequest } from '@evia/contracts';",
      "import { z } from '@evia/contracts/zod';",
      "import { z } from 'zod';",
      "import pg from 'pg';",
    ];
    for (const code of forbidden) expect(lint(code), code).toEqual(['no-restricted-imports']);
  });

  it('EVM-091 AC1: Buffer, process, timers, Math.random and SQL builders are errors; ports and pure code are allowed', () => {
    const forbidden = [
      'const b = Buffer.from("x");',
      'const e = process.env;',
      'setImmediate(() => 1);',
      'setTimeout(() => 1, 5);',
      'setInterval(() => 1, 5);',
      'const r = Math.random();',
      "sql.raw('x');",
    ];
    for (const code of forbidden) expect(lint(code), code).not.toEqual([]);
    const allowed = [
      "import { helper } from './helper.js';",
      'const m = Math.floor(1.5) + Math.max(1, 2);',
      'const now = clock.now();',
      'random.getRandomValues(bytes);',
    ];
    for (const code of allowed) expect(lint(code), code).toEqual([]);
  });

  it('EVM-091 AC1: the block applies to src of packages/sync-core only, through the shared config()', () => {
    expect(PORTABLE_CORE_FILES).toEqual(['src/**/*.ts']);
    const own = config({ tsconfigRootDir: '/repo/packages/sync-core' });
    const other = config({ tsconfigRootDir: '/repo/packages/x' });
    expect(own.some((entry) => JSON.stringify(entry.rules ?? {}).includes('Math'))).toBe(true);
    expect(other.some((entry) => JSON.stringify(entry.rules ?? {}).includes('Math'))).toBe(false);
    expect(config({ tsconfigRootDir: String.raw`C:\repo\packages\sync-core` }).length).toBe(own.length);
  });
});

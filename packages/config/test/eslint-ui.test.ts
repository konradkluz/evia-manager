import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { MOBILE_UI_FILES, mobileUi, sqlSafety, WEB_UI_FILES, webUi } from '../src/eslint.ts';

/** Lints a TSX-like snippet (JSX in a .jsx file — no type information needed) with the web UI block. */
function lint(code: string, filename = 'src/shell/app-shell.jsx'): string[] {
  const linter = new Linter({ configType: 'flat' });
  const base: Linter.Config = {
    files: ['**/*.jsx', '**/*.js'],
    languageOptions: { sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
  };
  const messages = linter.verify(code, [base, ...sqlSafety(), ...webUi({ files: ['src/**/*.jsx', 'src/**/*.js'] })], filename);
  return messages.map((message) => `${message.ruleId ?? ''}: ${message.message}`);
}

describe('web UI lint rules (EVM-008 AC3, AC4; styleguide § 7.2, SR-WEB-03)', () => {
  it('EVM-008 AC4 dangerouslySetInnerHTML is rejected (SR-WEB-03)', () => {
    expect(lint('const a = <div dangerouslySetInnerHTML={{ __html: html }} />;')).toEqual([expect.stringContaining('SR-WEB-03')]);
  });

  it('EVM-008 AC3 all UI strings come from pl i18n resources: literal text in JSX and in labelling attributes is rejected', () => {
    const forbidden = [
      'const a = <h1>Zlecenia</h1>;',
      'const a = <button aria-label="Menu" />;',
      'const a = <img alt="Logo" src={src} />;',
      'const a = <input placeholder="Szukaj" />;',
      'const a = <a title="Zlecenia" href="/" />;',
    ];
    for (const code of forbidden) expect(lint(code), code).toEqual([expect.stringContaining('i18n')]);
    const allowed = [
      "const a = <h1>{t('workOrders.title')}</h1>;",
      "const a = <button aria-label={t('shell.menu')} />;",
      'const a = <div>\n  {children}\n</div>;',
      'const a = <svg aria-hidden="true" />;',
    ];
    for (const code of allowed) expect(lint(code), code).toEqual([]);
  });

  it('EVM-008 AC3 styles use tokens only: inline styles, arbitrary Tailwind values and literal colours or lengths are rejected', () => {
    const forbidden = [
      'const a = <div style={{ color: "red" }} />;',
      'const a = <div className="p-[13px]" />;',
      'const a = <div className="bg-(--evm-color-bg-canvas)" />;',
      'const a = <div className={`w-[${size}]`} />;',
      "const classes = 'flex medium:w-[72px]';",
      "const colour = '#FF0000';",
      "const colour = 'rgb(0 0 0)';",
      "const width = '13px';",
      "const width = '1.5rem';",
    ];
    for (const code of forbidden) expect(lint(code), code).not.toEqual([]);
    const allowed = [
      'const a = <div className="flex gap-stack-md bg-bg-canvas text-text-primary" />;',
      'const a = <div className="medium:w-sidebar-width-collapsed expanded:w-sidebar-width-expanded" />;',
      "const id = 'main-content';",
    ];
    for (const code of allowed) expect(lint(code), code).toEqual([]);
  });

  it('EVM-008 AC4 the SQL safety rules stay active next to the UI rules (one no-restricted-syntax list)', () => {
    expect(lint("sql.raw('select 1');")).toEqual([expect.stringContaining('SR-INPUT-03')]);
  });

  it('EVM-008 AC3 the rules of hooks are enforced in UI code', () => {
    const code = 'export function Shell({ open }) { if (open) { useEffect(() => {}); } return null; }\nimport { useEffect } from "react";';
    expect(lint(code)).toEqual([expect.stringContaining('react-hooks/rules-of-hooks')]);
  });

  it('EVM-008 AC3 by default the UI rules cover TypeScript and TSX sources of the workspace', () => {
    expect(WEB_UI_FILES).toEqual(['src/**/*.ts', 'src/**/*.tsx']);
    expect(webUi().every((block) => block.files === WEB_UI_FILES)).toBe(true);
  });
});

/** Lints a TSX-like snippet (JSX in a .jsx file) with the mobile UI block. */
function lintMobile(code: string, filename = 'src/screens/orders.jsx'): string[] {
  const linter = new Linter({ configType: 'flat' });
  const base: Linter.Config = {
    files: ['**/*.jsx', '**/*.js'],
    languageOptions: { sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
  };
  const messages = linter.verify(code, [base, ...mobileUi({ files: ['src/**/*.jsx', 'src/**/*.js'] })], filename);
  return messages.map((message) => `${message.ruleId ?? ''}: ${message.message}`);
}

describe('mobile UI lint rules (EVM-009 AC1, AC6; styleguide § 7.2, SR-LOG-08)', () => {
  it('EVM-009 AC1 all UI strings come from pl i18n resources: literal text in JSX and in labelling props is rejected', () => {
    const forbidden = [
      'const a = <Text>Zlecenia</Text>;',
      'const a = <Pressable accessibilityLabel="Menu" />;',
      'const a = <Pressable accessibilityHint="Otwórz" />;',
      'const a = <TextInput placeholder="Szukaj" />;',
      'const a = <Button label="Zapisz" />;',
    ];
    for (const code of forbidden) expect(lintMobile(code), code).toEqual([expect.stringContaining('i18n')]);
    const allowed = [
      "const a = <Text>{t('shell.orders.title')}</Text>;",
      "const a = <Pressable accessibilityLabel={t('shell.menu')} />;",
      'const a = <View>\n  {children}\n</View>;',
      'const a = <View testID="orders-empty" accessibilityRole="button" />;',
    ];
    for (const code of allowed) expect(lintMobile(code), code).toEqual([]);
  });

  it('EVM-009 AC1 styles use tokens only: literal colours and literal sizes of spacing and type properties are rejected', () => {
    const forbidden = [
      "const colour = '#FF0000';",
      "const colour = 'rgb(0 0 0)';",
      "const colour = 'rgba(0, 0, 0, 0.5)';",
      'const style = { padding: 8 };',
      'const style = { fontSize: 16, lineHeight: 24 };',
      'const style = { minHeight: 48 };',
      'const style = { borderRadius: 12 };',
      "const style = { marginTop: '8px' };",
    ];
    for (const code of forbidden) expect(lintMobile(code), code).not.toEqual([]);
    const allowed = [
      'const style = { padding: space.inset.md, minHeight: size.touchTarget.min };',
      'const style = { flex: 1, flexGrow: 1, borderWidth: 0, opacity: 0.5 };',
      "const style = { backgroundColor: 'transparent' };",
      'const style = { width: `${percent}%` };',
      'const style = { margin: 0 };',
    ];
    for (const code of allowed) expect(lintMobile(code), code).toEqual([]);
  });

  it('EVM-009 AC6 console output is rejected: the only sanctioned logger takes fixed event names (SR-LOG-08)', () => {
    for (const code of ['console.log(x);', 'console.warn(x);', 'console.error(x);']) {
      expect(lintMobile(code), code).toEqual([expect.stringContaining('no-console')]);
    }
  });

  it('EVM-009 AC6 raw HTML and inline eval-like constructs from the web rules do not apply, but the SQL ban stays active', () => {
    expect(lintMobile("sql.raw('select 1');")).toEqual([expect.stringContaining('SR-INPUT-03')]);
  });

  it('EVM-009 AC6 only the API client imports the generated contract, and nobody imports the authorization manifest (ADR-0004)', () => {
    for (const code of [
      "import { client } from '@evia/contracts';",
      "import { z } from '@evia/contracts/zod';",
      "import { m } from '@evia/contracts/authz';",
    ]) {
      expect(lintMobile(code, 'src/screens/orders.js'), code).toEqual([expect.stringContaining('no-restricted-imports')]);
    }
    const apiClient = "import { createClient } from '@evia/contracts';\nimport { z } from '@evia/contracts/zod';";
    expect(lintMobile(apiClient, 'src/api/health.js')).toEqual([]);
    expect(lintMobile("import { m } from '@evia/contracts/authz';", 'src/api/health.js')).toEqual([
      expect.stringContaining('no-restricted-imports'),
    ]);
    expect(lintMobile("import { Pool } from 'pg';", 'src/api/health.js')).toEqual([expect.stringContaining('no-restricted-imports')]);
  });

  it('EVM-009 AC1 the rules of hooks are enforced in mobile UI code', () => {
    const code = 'export function Shell({ open }) { if (open) { useEffect(() => {}); } return null; }\nimport { useEffect } from "react";';
    expect(lintMobile(code)).toEqual([expect.stringContaining('react-hooks/rules-of-hooks')]);
  });

  it('EVM-009 AC1 by default the rules cover TypeScript and TSX sources of src/', () => {
    expect(MOBILE_UI_FILES).toEqual(['src/**/*.ts', 'src/**/*.tsx']);
    expect(mobileUi().every((block) => block.files === MOBILE_UI_FILES || block.files?.[0] === 'src/api/**')).toBe(true);
  });
});

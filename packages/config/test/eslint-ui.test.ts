import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { sqlSafety, WEB_UI_FILES, webUi } from '../src/eslint.ts';

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

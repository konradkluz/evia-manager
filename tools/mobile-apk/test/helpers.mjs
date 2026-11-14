import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const read = (/** @type {string} */ name) => readFileSync(join(FIXTURES, name), 'utf8');

/** The declaration of the build for approved clauses (apps/mobile/plugins/expo-config.ts `extra.privacyClauses`). */
export const FINAL_CLAUSES = '{"extra":{"buildVariant":"release","privacyClauses":{"draft":false,"markers":false}}}';
/** `apkanalyzer dex packages --defined-only` of the app: its own and androidx packages only. */
export const DEX_PACKAGES = ['P d 1 1 100 pl.eviacharge.manager', 'P d 1 1 100 androidx.core', ''].join('\n');

/**
 * The recorded answers of apkanalyzer for the package of the app (synthetic), keyed by the arguments after the main class.
 * @param {string[]} args arguments of the java process
 * @param {string} apk the name of the package in the arguments
 * @param {string} [bundle] contents of assets/index.android.bundle; when given, the package has such an entry
 * @param {string} [appConfig] contents of assets/app.config (the `extra` of the build with the declaration of the privacy clauses, EVM-102 AC6)
 * @returns {string | undefined}
 */
export function analyzerAnswers(args, apk, bundle, appConfig = FINAL_CLAUSES) {
  const key = args.slice(args.indexOf('com.android.tools.apk.analyzer.ApkAnalyzerCli') + 1).join(' ');
  /** @type {Record<string, string>} */
  const answers = {
    [`manifest print ${apk}`]: read('manifest-print.txt'),
    [`files list ${apk}`]:
      bundle === undefined
        ? `${read('files-list.txt')}
/assets/app.config
`
        : `${read('files-list.txt')}
/assets/index.android.bundle
/assets/app.config
`,
    [`files cat --file assets/app.config ${apk}`]: appConfig,
    [`dex packages --defined-only ${apk}`]: DEX_PACKAGES,
    [`files cat --file assets/index.android.bundle ${apk}`]: bundle ?? '',
    [`apk summary ${apk}`]: read('apk-summary.txt'),
    [`resources value --config default --type xml --name evia_network_security_config ${apk}`]: 'x/n.xml',
    [`resources value --config default --type xml --name evia_backup_rules ${apk}`]: 'x/b.xml',
    [`resources value --config default --type xml --name evia_data_extraction_rules ${apk}`]: 'x/d.xml',
    [`resources xml --file x/n.xml ${apk}`]: read('evia_network_security_config.xml.txt'),
    [`resources xml --file x/b.xml ${apk}`]: read('evia_backup_rules.xml.txt'),
    [`resources xml --file x/d.xml ${apk}`]: read('evia_data_extraction_rules.xml.txt'),
  };
  return answers[key];
}

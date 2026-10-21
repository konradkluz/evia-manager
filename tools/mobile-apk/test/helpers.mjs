import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const read = (/** @type {string} */ name) => readFileSync(join(FIXTURES, name), 'utf8');

/**
 * The recorded answers of apkanalyzer for the package of the app (synthetic), keyed by the arguments after the main class.
 * @param {string[]} args arguments of the java process
 * @param {string} apk the name of the package in the arguments
 * @returns {string | undefined}
 */
export function analyzerAnswers(args, apk) {
  const key = args.slice(args.indexOf('com.android.tools.apk.analyzer.ApkAnalyzerCli') + 1).join(' ');
  /** @type {Record<string, string>} */
  const answers = {
    [`manifest print ${apk}`]: read('manifest-print.txt'),
    [`files list ${apk}`]: read('files-list.txt'),
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

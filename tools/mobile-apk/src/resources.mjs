// @ts-check
/**
 * Assertions on the XML resources of the built APK that carry the security settings of the manifest (EVM-009 AC6): the network
 * security config (SR-COMM-04; MASVS-NETWORK-1/2), the backup rules and the data extraction rules (SR-MOB-02; MASVS-STORAGE-2).
 */
import { childrenNamed, parseXml } from './xml.mjs';

/** Everything the app stores must stay out of backups and device transfers. */
const BACKUP_DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];

/**
 * No plain HTTP anywhere, only the system trust store (a user-installed CA cannot intercept the traffic), no pins to maintain here.
 * @param {string} xml
 * @returns {string[]}
 */
export function checkNetworkSecurityConfig(xml) {
  /** @type {string[]} */
  const problems = [];
  const root = parseXml(xml);
  if (root.name !== 'network-security-config') return ['not a network-security-config'];
  const base = childrenNamed(root, 'base-config')[0];
  if (base === undefined || base.attributes['cleartextTrafficPermitted'] !== 'false')
    problems.push('base-config does not forbid cleartext traffic');
  const anchors =
    base === undefined ? [] : childrenNamed(base, 'trust-anchors').flatMap((element) => childrenNamed(element, 'certificates'));
  if (anchors.length === 0 || anchors.some((certificates) => certificates.attributes['src'] !== 'system')) {
    problems.push('trust anchors are not the system store only');
  }
  if (childrenNamed(root, 'domain-config').length > 0)
    problems.push('domain-config is present (no cleartext exception in a release build)');
  if (childrenNamed(root, 'debug-overrides').length > 0) problems.push('debug-overrides is present');
  return problems;
}

/**
 * @param {import('./xml.mjs').XmlElement} section
 * @param {string} where
 * @returns {string[]}
 */
function excludeAllProblems(section, where) {
  const excluded = childrenNamed(section, 'exclude').map((element) => element.attributes['domain']);
  /** @type {string[]} */
  const problems = BACKUP_DOMAINS.filter((domain) => !excluded.includes(domain)).map((domain) => `${where} does not exclude ${domain}`);
  if (childrenNamed(section, 'include').length > 0) problems.push(`${where} includes data`);
  return problems;
}

/** @param {string} xml */
export function checkBackupRules(xml) {
  const root = parseXml(xml);
  return root.name === 'full-backup-content' ? excludeAllProblems(root, 'full-backup-content') : ['not a full-backup-content'];
}

/** @param {string} xml */
export function checkDataExtractionRules(xml) {
  const root = parseXml(xml);
  if (root.name !== 'data-extraction-rules') return ['not a data-extraction-rules'];
  /** @type {string[]} */
  const problems = [];
  for (const sectionName of ['cloud-backup', 'device-transfer']) {
    const section = childrenNamed(root, sectionName)[0];
    problems.push(...(section === undefined ? [`${sectionName} is missing`] : excludeAllProblems(section, sectionName)));
  }
  return problems;
}

// @ts-check
/**
 * Validator configuration: `lifecycle.config.json` = the rules table from
 * docs/process/document-lifecycle.md → „Dozwolone lokalizacje” (data, no code).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check, errorMessage, ToolError } from './errors.mjs';
import { compilePattern, matchPattern } from './patterns.mjs';

/** @typedef {import('./patterns.mjs').CompiledPattern} CompiledPattern */
/** @typedef {import('./patterns.mjs').PatternCaptures} PatternCaptures */

export const CONFIG_FILE = fileURLToPath(new URL('../lifecycle.config.json', import.meta.url));

/** Lifecycle classes — allowed values of the `lifecycle` field. */
export const CLASSES = ['permanent', 'living', 'milestone', 'ephemeral'];

/** Rule classes: a lifecycle class, `lifecycle` (class from the file's field) or `forbidden`. */
const RULE_CLASSES = [...CLASSES, 'lifecycle', 'forbidden'];

/** Allowed `milestoneFrom` per rule class; other classes must not define it. */
const MILESTONE_FROM_BY_CLASS = new Map([
  ['milestone', ['story', 'spike']],
  ['lifecycle', ['field']],
]);

/** Placeholder each pattern of a rule must contain for its `milestoneFrom`. */
const REQUIRED_PLACEHOLDER = new Map([
  ['story', { group: 'evmId', placeholder: '<EVM-ID>' }],
  ['spike', { group: 'name', placeholder: '<nazwa>' }],
]);

/**
 * @typedef {object} Rule
 * @property {number | null} id rule number from the policy table (null = default rule)
 * @property {CompiledPattern[]} patterns
 * @property {string} class `permanent` | `living` | `milestone` | `ephemeral` | `lifecycle` | `forbidden`
 * @property {string | null} milestoneFrom `story` | `spike` | `field` (milestone source) or null
 * @property {boolean} orphanCheck whether the „osierocony” warning applies
 */

/**
 * @typedef {object} Config
 * @property {string} policy path of the policy document (for messages)
 * @property {string} scratchDir directory for working files (ignored by git)
 * @property {{ path: string, section: string }} roadmap where the list of milestones lives
 * @property {CompiledPattern} milestoneDirPattern backlog directories naming milestones
 * @property {CompiledPattern} storyPattern story files (source of `milestone` for QA/UX evidence)
 * @property {string} spikesDir top-level directory with spike code (`spikes/<nazwa>/`)
 * @property {Rule[]} rules
 * @property {Rule} defaultRule
 */

/**
 * @param {string} [file]
 * @returns {Config}
 */
export function loadConfig(file = CONFIG_FILE) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ToolError(`nie można wczytać konfiguracji walidatora (${file}): ${errorMessage(error)}`);
  }
  return parseConfig(raw);
}

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** @param {unknown} value @returns {value is string} */
const isText = (value) => typeof value === 'string' && value !== '';

/**
 * @param {unknown} raw parsed JSON
 * @returns {Config}
 */
export function parseConfig(raw) {
  check(isObject(raw), 'konfiguracja: oczekiwano obiektu JSON');
  check(isText(raw.policy), 'konfiguracja: policy musi wskazywać plik polityki');
  check(isText(raw.scratchDir) && !raw.scratchDir.includes('/'), 'konfiguracja: scratchDir musi być nazwą katalogu bez /');
  check(isText(raw.spikesDir) && !raw.spikesDir.includes('/'), 'konfiguracja: spikesDir musi być nazwą katalogu bez /');
  check(
    isObject(raw.roadmap) && isText(raw.roadmap.path) && isText(raw.roadmap.section),
    'konfiguracja: roadmap wymaga pól path i section',
  );
  check(Array.isArray(raw.rules) && raw.rules.length > 0, 'konfiguracja: rules musi być niepustą listą reguł');
  check(isObject(raw.defaultRule) && raw.defaultRule.class === 'forbidden', 'konfiguracja: defaultRule musi mieć klasę forbidden');
  return {
    policy: raw.policy,
    scratchDir: raw.scratchDir,
    roadmap: { path: raw.roadmap.path, section: raw.roadmap.section },
    milestoneDirPattern: patternWith(raw.milestoneDirPattern, 'milestone', '<M#>', 'milestoneDirPattern'),
    storyPattern: patternWith(raw.storyPattern, 'evmId', '<EVM-ID>', 'storyPattern'),
    spikesDir: raw.spikesDir,
    rules: raw.rules.map((rule, index) => parseRule(rule, index, raw.spikesDir)),
    defaultRule: { id: null, patterns: [], class: 'forbidden', milestoneFrom: null, orphanCheck: false },
  };
}

/**
 * @param {unknown} value
 * @param {string} group required capture
 * @param {string} placeholder placeholder name for the message
 * @param {string} field configuration field name
 * @returns {CompiledPattern}
 */
function patternWith(value, group, placeholder, field) {
  const pattern = compilePattern(String(value));
  check(pattern.groups.includes(group), `konfiguracja: ${field} musi zawierać symbol ${placeholder}`);
  return pattern;
}

/**
 * @param {unknown} raw
 * @param {number} index
 * @param {string} spikesDir
 * @returns {Rule}
 */
function parseRule(raw, index, spikesDir) {
  const where = `konfiguracja: reguła ${index + 1}`;
  check(isObject(raw), `${where} musi być obiektem`);
  check(raw.id === index + 1, `${where}: id musi być równe ${index + 1} (reguły w kolejności z polityki)`);
  check(
    Array.isArray(raw.patterns) && raw.patterns.length > 0 && raw.patterns.every(isText),
    `${where}: patterns musi być niepustą listą wzorców`,
  );
  check(RULE_CLASSES.includes(raw.class), `${where}: nieznana klasa ${String(raw.class)}`);
  check(typeof raw.orphanCheck === 'boolean', `${where}: orphanCheck musi być true albo false`);
  const allowedSources = MILESTONE_FROM_BY_CLASS.get(raw.class) ?? [undefined];
  check(allowedSources.includes(raw.milestoneFrom), `${where}: niepoprawne milestoneFrom dla klasy ${raw.class}`);
  const patterns = raw.patterns.map(compilePattern);
  const required = REQUIRED_PLACEHOLDER.get(raw.milestoneFrom);
  for (const pattern of patterns) {
    check(
      required === undefined || pattern.groups.includes(required.group),
      `${where}: wzorzec ${pattern.source} musi zawierać symbol ${required?.placeholder}`,
    );
    check(
      raw.milestoneFrom !== 'spike' || pattern.source.startsWith(`${spikesDir}/<nazwa>/`),
      `${where}: wzorzec ${pattern.source} musi zaczynać się od ${spikesDir}/<nazwa>/ (spikesDir)`,
    );
  }
  return {
    id: raw.id,
    patterns,
    class: raw.class,
    milestoneFrom: raw.milestoneFrom ?? null,
    orphanCheck: raw.orphanCheck,
  };
}

/**
 * First matching rule wins; no match → default rule („niedozwolone”).
 * @param {Config} config
 * @param {string} path repository-relative path with `/`
 * @returns {{ rule: Rule, captures: PatternCaptures }}
 */
export function matchRule(config, path) {
  for (const rule of config.rules) {
    for (const pattern of rule.patterns) {
      const captures = matchPattern(pattern, path);
      if (captures) return { rule, captures };
    }
  }
  return { rule: config.defaultRule, captures: {} };
}

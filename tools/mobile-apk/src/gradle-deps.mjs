// @ts-check
/**
 * Checks of the Gradle side of the package (EVM-108 AC8; SR-MOB-12, SR-SUPPLY-06, MASVS-PRIVACY-1):
 * - `checkGradleDependencies`: the output of `gradlew :app:dependencies :expo-camera:dependencies --configuration releaseRuntimeClasspath`
 *   must not name any library of the forbidden groups (src/forbidden.mjs). ONLY the section `releaseRuntimeClasspath` counts: a
 *   `compileOnly` dependency (what the switched-off scanners become) is in `compileClasspath`, not in the package. Fail closed: an empty
 *   report, a missing project, a missing or empty section and any `FAILED` line (an incomplete tree) are findings;
 * - `checkMapping`: `mapping.txt` of R8. Minification renames the packages in DEX, so a check of DEX names alone could miss a class of
 *   ML Kit; the mapping holds the source names of every class that went into the package.
 * Findings carry the coordinate, the parent and the project (public names of libraries) — never the content of a file.
 */
import { forbiddenPrefixOf, isForbiddenCoordinate } from './forbidden.mjs';

/** The projects whose release runtime classpath is read: the app and the camera library. */
export const REQUIRED_PROJECTS = Object.freeze([':app', ':expo-camera']);
const CONFIGURATION = 'releaseRuntimeClasspath';
const ROOT = 'the root of the configuration';

/** `Project ':app'` / `Root project 'x'` of the header of a report. */
const PROJECT_HEADER = /^(?:Root project|Project) '([^']*)'/;
/** A line of the tree: the prefix of the depth (5 characters per level), the branch and the text. */
const TREE_LINE = /^((?:[| ] {4})*)[+\\]--- (.+)$/;

/**
 * @param {string} text the text of a tree line without the branch
 * @returns {{ label: string, coordinates: { group: string, artifact: string }[], constraint: boolean, failed: boolean }}
 */
function parseDependency(text) {
  const [first = ''] = text.split(/\s+/);
  const constraint = /\(c\)\s*$/.test(text);
  const failed = /\bFAILED\s*$/.test(text);
  /** @type {{ group: string, artifact: string }[]} */
  const coordinates = [];
  const label = first.startsWith('project') ? text.replace(/\s*(\(.*\)|FAILED)\s*$/, '').trim() : coordinateLabel(first);
  /** @param {string} token */
  const collect = (token) => {
    const [group = '', artifact = ''] = token.split(':');
    if (group !== '' && artifact !== '' && !token.startsWith('project')) coordinates.push({ group, artifact });
  };
  if (!first.startsWith('project')) collect(first);
  // a substitution (`a:b:1 -> c:d:2`) replaces the library: the replacement counts too (a version after `->` has no colon)
  const replacement = /->\s*(\S+)/.exec(text)?.[1];
  if (replacement !== undefined && replacement.includes(':')) collect(replacement);
  return { label, coordinates, constraint, failed };
}

/** @param {string} token `group:artifact[:version]` @returns {string} `group:artifact` */
function coordinateLabel(token) {
  return token.split(':').slice(0, 2).join(':');
}

/**
 * @param {string[]} lines the lines of the project block
 * @param {string} project
 * @returns {string[]} problems
 */
function checkProject(lines, project) {
  const start = lines.findIndex((line) => line === CONFIGURATION || line.startsWith(`${CONFIGURATION} `));
  if (start === -1) return [`${project}: the section ${CONFIGURATION} is missing`];
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const parents = [];
  /** @type {Set<string>} */
  const reported = new Set();
  let dependencies = 0;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') break;
    const match = TREE_LINE.exec(line);
    if (match === null) continue;
    const depth = (match[1] ?? '').length / 5;
    const dependency = parseDependency(match[2] ?? '');
    parents.length = depth;
    parents[depth] = dependency.label;
    dependencies += 1;
    if (dependency.failed) {
      problems.push(`${project}: ${dependency.label} could not be resolved (FAILED); the tree is incomplete`);
      continue;
    }
    if (dependency.constraint) continue;
    for (const { group, artifact } of dependency.coordinates) {
      const coordinate = `${group}:${artifact}`;
      if (!isForbiddenCoordinate(group, artifact) || reported.has(coordinate)) continue;
      reported.add(coordinate);
      problems.push(`${project}: ${coordinate} in ${CONFIGURATION} (from ${parents[depth - 1] ?? ROOT})`);
    }
  }
  return dependencies === 0 ? [`${project}: the section ${CONFIGURATION} holds no dependency`] : problems;
}

/**
 * @param {string} text the output of `gradlew <project>:dependencies --configuration releaseRuntimeClasspath` for each project
 * @param {readonly string[]} [projects] the projects that must be in the report
 * @returns {string[]} problems; empty when no library of a forbidden group is in the release runtime classpath
 */
export function checkGradleDependencies(text, projects = REQUIRED_PROJECTS) {
  if (text.trim() === '') return ['the dependency report is empty'];
  /** @type {Map<string, string[]>} */
  const blocks = new Map();
  /** @type {string[] | undefined} */
  let current;
  for (const line of text.split(/\r?\n/)) {
    const header = PROJECT_HEADER.exec(line);
    if (header !== null) {
      current = [];
      blocks.set(header[1] ?? '', current);
    } else current?.push(line);
  }
  return projects.flatMap((project) => {
    const lines = blocks.get(project);
    return lines === undefined ? [`${project}: the report of the project is missing`] : checkProject(lines, project);
  });
}

/** A class line of `mapping.txt`: not indented, `source.Name -> renamed:`. */
const MAPPING_CLASS = /^([A-Za-z_][\w.$]*) -> [\w.$]+:$/;

/**
 * @param {string} text `app/build/outputs/mapping/release/mapping.txt`
 * @returns {string[]} problems; empty when no class of a forbidden package is in the package
 */
export function checkMapping(text) {
  /** @type {Map<string, string[]>} */
  const found = new Map();
  let classes = 0;
  for (const line of text.split(/\r?\n/)) {
    const name = MAPPING_CLASS.exec(line)?.[1];
    if (name === undefined) continue;
    classes += 1;
    const prefix = forbiddenPrefixOf(name);
    if (prefix !== undefined) found.set(prefix, [...(found.get(prefix) ?? []), name]);
  }
  if (classes === 0) return ['mapping.txt is empty or holds no class (minification is on: a mapping is required)'];
  return [...found].map(
    ([prefix, names]) =>
      `mapping.txt: ${String(names.length)} ${names.length === 1 ? 'class' : 'classes'} of ${prefix} (for example ${names[0] ?? ''})`,
  );
}

// @ts-check
/**
 * Classification and validation of `.md` files according to docs/process/document-lifecycle.md.
 * A pure function of the file set — no disk or git access here (see repository.mjs).
 * Errors only for unambiguous violations; heuristics are warnings.
 */
import { posix } from 'node:path';
import { CLASSES, matchRule } from './config.mjs';
import { isValidIsoDate } from './dates.mjs';
import { normalizeText, parseFrontmatter } from './frontmatter.mjs';
import { collectMilestones, isMilestoneId } from './milestones.mjs';
import { matchPattern } from './patterns.mjs';
import { buildReferenceIndex } from './references.mjs';
import { compareCodeUnits, isMarkdown, quote } from './text.mjs';

/** Entry point in any directory — never „osierocony” (policy → „Dozwolone lokalizacje”). */
const ENTRY_POINT = 'README.md';

/** Polish names of the lifecycle classes. */
export const CLASS_LABELS = /** @type {Record<string, string>} */ ({
  permanent: 'trwały',
  living: 'żywy',
  milestone: 'kamień milowy',
  ephemeral: 'roboczy',
});

const DATE_FIELDS = ['expires', 'review_by'];

/** Date fields allowed per class; any other date field is an error. */
const ALLOWED_DATE_FIELDS = /** @type {Record<string, string[]>} */ ({
  permanent: [],
  living: ['review_by'],
  milestone: ['expires'],
});

/**
 * @typedef {object} Finding
 * @property {'error' | 'warning'} severity
 * @property {string} code stable identifier (tests check code + path)
 * @property {string} path repository-relative path (directories end with `/`)
 * @property {string | null} class lifecycle class of the file (null = none)
 * @property {string} reason Polish reason with a hint
 * @property {boolean} classError an error of the file's class (policy → „Błędy klasy”): no „osierocony” warning then
 */

/**
 * @typedef {object} FileRecord
 * @property {string} path
 * @property {number | null} ruleId matching rule (null = default rule)
 * @property {string | null} class effective lifecycle class (null = none: location or class error)
 * @property {string} classSource where the class comes from (`--list`)
 * @property {boolean} manual class set by hand — `lifecycle` field in docs/notes/
 * @property {string | null} milestone valid M# of a „kamień milowy” file
 * @property {string | null} milestoneSource where the M# comes from (cleanup report)
 * @property {string | null} spikeDir `spikes/<nazwa>/` for files of a spike directory
 * @property {boolean} orphanCheck whether the „osierocony” warning applies
 * @property {string[]} expired expired date fields, e.g. `expires 2026-10-01`
 * @property {boolean} orphan „osierocony” warning reported
 */

/**
 * @typedef {object} SpikeDir
 * @property {string} dir `spikes/<nazwa>/`
 * @property {string[]} files all files of the directory visible to git
 * @property {string | null} milestone valid M# from the directory's README.md
 */

/**
 * @typedef {object} RepositoryFiles
 * @property {string[]} paths files visible to git (repository-relative, `/`)
 * @property {(path: string) => string | null} read content of a file (null = not a regular file)
 * @property {boolean} scratchIgnored whether git ignores the scratch directory
 */

/**
 * @typedef {object} Analysis
 * @property {string} today `YYYY-MM-DD` (Europe/Warsaw)
 * @property {FileRecord[]} files `.md` files in code-unit order
 * @property {Finding[]} findings errors first, then by path and code
 * @property {number} errorCount
 * @property {number} warningCount
 * @property {string[]} milestones
 * @property {Map<string, SpikeDir>} spikes
 * @property {Map<string, string[]>} references target → documents referring to it
 */

/**
 * @typedef {object} Context
 * @property {import('./config.mjs').Config} config
 * @property {string} today
 * @property {string[]} milestones
 * @property {Map<string, Map<string, string>>} meta frontmatter fields per `.md` file
 * @property {Map<string, Array<{ path: string, milestone: string | undefined }>>} stories by EVM-ID
 * @property {Map<string, SpikeDir>} spikes
 * @property {Finding[]} findings
 */

/**
 * `kind`: `error` (default), `class-error` — an error of the file's class, set where it is reported (policy → „Błędy
 * klasy”), or `warning`.
 * @typedef {(code: string, reason: string, kind?: 'error' | 'class-error' | 'warning') => void} Report
 */

/**
 * @param {RepositoryFiles} repository
 * @param {{ config: import('./config.mjs').Config, today: string }} options
 * @returns {Analysis}
 */
export function analyze(repository, { config, today }) {
  const paths = [...new Set(repository.paths)].sort(compareCodeUnits);
  const markdown = paths.filter(isMarkdown);
  const texts = new Map(markdown.map((path) => [path, normalizeText(repository.read(path) ?? '')]));
  const meta = new Map(markdown.map((path) => [path, parseFrontmatter(String(texts.get(path)))]));
  const milestones = collectMilestones(paths, texts.get(config.roadmap.path) ?? '', config);
  /** @type {Context} */
  const ctx = {
    config,
    today,
    milestones,
    meta,
    stories: indexStories(markdown, meta, config),
    spikes: indexSpikes(paths, meta, config, milestones),
    findings: [],
  };
  checkScratch(paths, repository.scratchIgnored, ctx);
  checkSpikeReadmes(ctx);
  const files = markdown.map((path) => classify(path, ctx));
  const references = buildReferenceIndex(markdown, (path) => String(texts.get(path)));
  checkOrphans(files, references, ctx);
  const findings = ctx.findings.sort(compareFindings);
  return {
    today,
    files,
    findings,
    errorCount: findings.filter((finding) => finding.severity === 'error').length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    milestones,
    spikes: ctx.spikes,
    references,
  };
}

/**
 * „Osierocony” (warning): rules marked „tak”, README.md excluded, only correctly classified files
 * (a file with a class error already has an error — policy, „Raport sprzątania” → „osierocony”).
 * @param {FileRecord[]} files
 * @param {Map<string, string[]>} references
 * @param {Context} ctx
 */
function checkOrphans(files, references, ctx) {
  const classErrors = new Set(ctx.findings.filter((finding) => finding.classError).map((finding) => finding.path));
  for (const record of files) {
    if (!record.orphanCheck || record.class === null || record.class === 'ephemeral' || classErrors.has(record.path)) continue;
    if (posix.basename(record.path) === ENTRY_POINT || references.has(record.path)) continue;
    record.orphan = true;
    ctx.findings.push({
      severity: 'warning',
      code: 'orphan',
      path: record.path,
      class: record.class,
      reason:
        'osierocony: żaden inny plik .md się do niego nie odwołuje — dodaj odwołanie (np. w README katalogu albo w powiązanym dokumencie) albo zgłoś plik do przeglądu przy /milestone close',
      classError: false,
    });
  }
}

/**
 * @param {Finding} a
 * @param {Finding} b
 * @returns {number}
 */
function compareFindings(a, b) {
  const severity = Number(a.severity === 'warning') - Number(b.severity === 'warning');
  return severity || compareCodeUnits(a.path, b.path) || compareCodeUnits(a.code, b.code);
}

/**
 * @param {string} path
 * @param {string} spikesDir
 * @returns {string | null} `spikes/<nazwa>/` when the path lies inside a spike directory
 */
function spikeDirOf(path, spikesDir) {
  const segments = path.split('/');
  return segments.length >= 3 && segments[0] === spikesDir ? `${spikesDir}/${segments[1]}/` : null;
}

/**
 * @param {string[]} markdown
 * @param {Map<string, Map<string, string>>} meta
 * @param {import('./config.mjs').Config} config
 * @returns {Context['stories']}
 */
function indexStories(markdown, meta, config) {
  /** @type {Context['stories']} */
  const stories = new Map();
  for (const path of markdown) {
    const captures = matchPattern(config.storyPattern, path);
    if (!captures) continue;
    const id = String(captures.evmId);
    const list = stories.get(id) ?? [];
    list.push({ path, milestone: fieldsOf(meta, path).get('milestone') });
    stories.set(id, list);
  }
  return stories;
}

/**
 * Spike directories from the git file list (all file types, finding E).
 * @param {string[]} paths
 * @param {Map<string, Map<string, string>>} meta
 * @param {import('./config.mjs').Config} config
 * @param {string[]} milestones
 * @returns {Map<string, SpikeDir>}
 */
function indexSpikes(paths, meta, config, milestones) {
  /** @type {Map<string, SpikeDir>} */
  const spikes = new Map();
  for (const path of paths) {
    const dir = spikeDirOf(path, config.spikesDir);
    if (dir === null) continue;
    const spike = spikes.get(dir) ?? { dir, files: [], milestone: null };
    spike.files.push(path);
    spikes.set(dir, spike);
  }
  for (const spike of spikes.values()) {
    const value = meta.get(`${spike.dir}README.md`)?.get('milestone');
    spike.milestone = value !== undefined && milestones.includes(value) ? value : null;
  }
  return spikes;
}

/**
 * @param {Map<string, Map<string, string>>} meta
 * @param {string} path a `.md` path from the set
 * @returns {Map<string, string>}
 */
function fieldsOf(meta, path) {
  return /** @type {Map<string, string>} */ (meta.get(path));
}

/**
 * Every file in the scratch directory visible to git is an error; so is a scratch directory git does not ignore.
 * @param {string[]} paths
 * @param {boolean} scratchIgnored
 * @param {Context} ctx
 */
function checkScratch(paths, scratchIgnored, ctx) {
  const prefix = `${ctx.config.scratchDir}/`;
  /** @param {string} code @param {string} path @param {string} reason @param {boolean} classError */
  const error = (code, path, reason, classError) =>
    ctx.findings.push({ severity: 'error', code, path, class: 'ephemeral', reason, classError });
  if (!scratchIgnored) {
    error(
      'scratch-not-ignored',
      prefix,
      `katalog ${prefix} nie jest ignorowany przez git — przywróć wpis ${prefix} w .gitignore (pliki robocze nie mogą trafić do repozytorium)`,
      false,
    );
  }
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    error(
      'ephemeral-tracked',
      path,
      `plik roboczy widoczny dla gita (śledzony albo nieignorowany) — usuń go z indeksu (git rm --cached -- ${path}) i trzymaj tylko w ${prefix} ignorowanym przez git`,
      true,
    );
  }
}

/** @param {Context} ctx */
function checkSpikeReadmes(ctx) {
  for (const spike of ctx.spikes.values()) {
    if (ctx.meta.has(`${spike.dir}README.md`)) continue;
    ctx.findings.push({
      severity: 'error',
      code: 'spike-readme-missing',
      path: spike.dir,
      class: 'milestone',
      reason: `katalog spike'a bez README.md — dodaj ${spike.dir}README.md z polem milestone (M#) i ID historyjki spike'a`,
      classError: false,
    });
  }
}

/**
 * @param {string | undefined} value
 * @param {string[]} milestones
 * @returns {'missing' | 'format' | 'unknown' | null} problem with an M# value, null when valid
 */
function milestoneProblem(value, milestones) {
  if (value === undefined) return 'missing';
  if (!isMilestoneId(value)) return 'format';
  return milestones.includes(value) ? null : 'unknown';
}

/**
 * @param {string} value
 * @param {'format' | 'unknown'} problem
 * @param {string[]} milestones
 * @returns {string}
 */
function invalidMilestoneText(value, problem, milestones) {
  return problem === 'format'
    ? `kamień milowy ${quote(value)} w złym formacie — wymagane M i cyfry (np. M0)`
    : `nieistniejący kamień milowy ${quote(value)} — dozwolone: ${milestones.join(', ')} (docs/product/roadmap.md → „Przegląd”)`;
}

/**
 * @param {string} path
 * @param {Context} ctx
 * @returns {FileRecord}
 */
function classify(path, ctx) {
  const { rule, captures } = matchRule(ctx.config, path);
  const fields = fieldsOf(ctx.meta, path);
  const lifecycle = fields.get('lifecycle');
  const ruleText = rule.id === null ? 'brak pasującej reguły' : `reguła ${rule.id}`;
  /** @type {FileRecord} */
  const record = {
    path,
    ruleId: rule.id,
    class: null,
    classSource: rule.class === 'forbidden' ? `${ruleText} — lokalizacja niedozwolona` : ruleText,
    manual: false,
    milestone: null,
    milestoneSource: null,
    spikeDir: spikeDirOf(path, ctx.config.spikesDir),
    orphanCheck: rule.orphanCheck,
    expired: [],
    orphan: false,
  };
  /** @type {Report} */
  const report = (code, reason, kind = 'error') => {
    const severity = kind === 'warning' ? 'warning' : 'error';
    ctx.findings.push({ severity, code, path, class: record.class, reason, classError: kind === 'class-error' });
  };
  const scratch = `${ctx.config.scratchDir}/`;
  const ephemeralOutside = `plik roboczy (lifecycle: ephemeral) w części repozytorium śledzonej przez git — zapisuj go w ${scratch} (ignorowany przez git) albo w scratchpadzie sesji`;
  const unknownClass = `nieznana klasa ${quote(String(lifecycle))} w polu lifecycle — dozwolone wartości: ${CLASSES.join(', ')}`;

  if (rule.class === 'forbidden') {
    if (lifecycle === 'ephemeral') {
      record.class = 'ephemeral';
      report('ephemeral-tracked', ephemeralOutside, 'class-error');
    } else {
      const where = rule.id === null ? 'brak pasującej reguły' : `reguła ${rule.id}: katalog o ściśle określonej strukturze`;
      const renamed = path.replace(/\.md$/i, '.md');
      const allowedAfterRename = renamed !== path ? matchRule(ctx.config, renamed).rule : null;
      report(
        'location-forbidden',
        allowedAfterRename && allowedAfterRename.class !== 'forbidden'
          ? `plik poza dozwolonymi lokalizacjami (${where}) — zmień rozszerzenie na .md (${renamed}): po tej zmianie plik pasuje do reguły ${allowedAfterRename.id}; lokalizacje: ${ctx.config.policy} → „Dozwolone lokalizacje”`
          : `plik poza dozwolonymi lokalizacjami (${where}) — przenieś go do docs/notes/ z polem lifecycle albo, jeśli to plik roboczy, do ${scratch}; lokalizacje: ${ctx.config.policy} → „Dozwolone lokalizacje”`,
        'class-error',
      );
    }
    return record;
  }
  if (rule.class === 'ephemeral') {
    // A file of the scratch directory in the git set — reported once by checkScratch.
    record.class = 'ephemeral';
    return record;
  }
  if (rule.class === 'lifecycle') {
    if (lifecycle === undefined) {
      report('class-missing', 'brak klasy — plik w docs/notes/ wymaga pola lifecycle: permanent, living albo milestone', 'class-error');
      return record;
    }
    if (!CLASSES.includes(lifecycle)) {
      report('class-unknown', unknownClass, 'class-error');
      return record;
    }
    if (lifecycle === 'ephemeral') {
      record.class = 'ephemeral';
      report('ephemeral-tracked', ephemeralOutside, 'class-error');
      return record;
    }
    record.class = lifecycle;
    record.manual = true;
    record.classSource = `pole lifecycle (${ruleText})`;
    if (lifecycle === 'milestone') milestoneFromField(record, fields, ctx, report);
  } else {
    record.class = rule.class;
    if (lifecycle !== undefined && !CLASSES.includes(lifecycle)) report('class-unknown', unknownClass, 'class-error');
    else if (lifecycle === 'ephemeral') report('ephemeral-tracked', ephemeralOutside, 'class-error');
    else if (lifecycle !== undefined && lifecycle !== rule.class) {
      report(
        'class-conflict',
        `klasa sprzeczna z lokalizacją — pole lifecycle: ${quote(lifecycle)}, a ${ruleText} nadaje klasę ${CLASS_LABELS[rule.class]} (${rule.class}); klasę dokumentu zmienia tylko Konrad przez zmianę polityki`,
        'class-error',
      );
    }
    if (rule.milestoneFrom === 'story') milestoneFromStory(record, String(captures.evmId), fields, ctx, report);
    if (rule.milestoneFrom === 'spike') milestoneFromSpike(record, fields, ctx, report);
  }
  checkDates(record, fields, ctx.today, report);
  return record;
}

/**
 * Rule 14: `docs/notes/` with `lifecycle: milestone` — M# from the file's own `milestone` field.
 * @param {FileRecord} record
 * @param {Map<string, string>} fields
 * @param {Context} ctx
 * @param {Report} report
 */
function milestoneFromField(record, fields, ctx, report) {
  const value = fields.get('milestone');
  const problem = milestoneProblem(value, ctx.milestones);
  if (problem === 'missing') {
    report('milestone-missing', 'kamień milowy bez M# — dodaj pole milestone: M# (np. M0)');
  } else if (problem !== null) {
    report('milestone-unknown', invalidMilestoneText(String(value), problem, ctx.milestones));
  } else {
    record.milestone = String(value);
    record.milestoneSource = 'pole milestone';
  }
}

/**
 * Rules 11–12: QA / UX evidence — M# from the `milestone` field of story `<EVM-ID>`.
 * @param {FileRecord} record
 * @param {string} id EVM-ID from the path
 * @param {Map<string, string>} fields
 * @param {Context} ctx
 * @param {Report} report
 */
function milestoneFromStory(record, id, fields, ctx, report) {
  const stories = ctx.stories.get(id) ?? [];
  if (stories.length !== 1) {
    report(
      'milestone-missing',
      stories.length === 0
        ? `kamień milowy bez M# — brak historyjki ${id} w docs/backlog/; dowód QA/UX musi leżeć w katalogu istniejącej historyjki`
        : `kamień milowy bez M# — kilka historyjek o ID ${id} (${stories.map((story) => story.path).join(', ')})`,
    );
    return;
  }
  const [story] = stories;
  const problem = milestoneProblem(story.milestone, ctx.milestones);
  if (problem === 'missing') {
    report('milestone-missing', `kamień milowy bez M# — historyjka ${id} (${story.path}) nie ma pola milestone`);
    return;
  }
  if (problem !== null) {
    report('milestone-unknown', `historyjka ${id}: ${invalidMilestoneText(String(story.milestone), problem, ctx.milestones)}`);
    return;
  }
  record.milestone = String(story.milestone);
  record.milestoneSource = `pole milestone historyjki ${id}`;
  checkOwnMilestone(record, fields, report);
}

/**
 * Rule 13: spike directory — M# from `spikes/<nazwa>/README.md` (mandatory there).
 * @param {FileRecord} record
 * @param {Map<string, string>} fields
 * @param {Context} ctx
 * @param {Report} report
 */
function milestoneFromSpike(record, fields, ctx, report) {
  const spike = /** @type {SpikeDir} */ (ctx.spikes.get(String(record.spikeDir)));
  const readme = `${spike.dir}README.md`;
  if (record.path === readme) {
    const value = fields.get('milestone');
    const problem = milestoneProblem(value, ctx.milestones);
    if (problem === 'missing') {
      report(
        'milestone-missing',
        "kamień milowy bez M# — README spike'a wymaga pola milestone: M# (kamień, do którego potrzebny jest kod spike'a)",
      );
    } else if (problem !== null) {
      report('milestone-unknown', invalidMilestoneText(String(value), problem, ctx.milestones));
    } else {
      record.milestone = String(value);
      record.milestoneSource = `pole milestone w ${readme}`;
    }
    return;
  }
  // Missing or invalid README milestone is reported once, on the README or the directory.
  if (spike.milestone === null) return;
  record.milestone = spike.milestone;
  record.milestoneSource = `pole milestone w ${readme}`;
  checkOwnMilestone(record, fields, report);
}

/**
 * A `milestone` field in a file whose M# comes from its location must agree with it (finding D).
 * @param {FileRecord} record
 * @param {Map<string, string>} fields
 * @param {Report} report
 */
function checkOwnMilestone(record, fields, report) {
  const own = fields.get('milestone');
  if (own === undefined || own === record.milestone) return;
  report(
    'class-conflict',
    `kamień milowy sprzeczny z lokalizacją — pole milestone: ${quote(own)}, a z lokalizacji wynika ${record.milestone} (${record.milestoneSource})`,
    'class-error',
  );
}

/**
 * Date fields: format and calendar validity, allowed for the class, „przeterminowany” when earlier than today.
 * @param {FileRecord} record a file with a lifecycle class (permanent, living or milestone)
 * @param {Map<string, string>} fields
 * @param {string} today `YYYY-MM-DD` in Europe/Warsaw
 * @param {Report} report
 */
function checkDates(record, fields, today, report) {
  const cls = String(record.class);
  for (const field of DATE_FIELDS) {
    const value = fields.get(field);
    if (value === undefined) continue;
    if (!isValidIsoDate(value)) {
      report(
        'date-invalid',
        `niepoprawna data w polu ${field}: ${quote(value)} — wymagany format YYYY-MM-DD i prawdziwa data kalendarzowa`,
      );
    } else if (!ALLOWED_DATE_FIELDS[cls].includes(field)) {
      report(
        'date-not-allowed',
        field === 'expires'
          ? `pole expires niedozwolone dla klasy ${CLASS_LABELS[cls]} — sprzeczność: tylko plik „kamień milowy” ma datę ważności (plik żywy: review_by)`
          : `pole review_by niedozwolone dla klasy ${CLASS_LABELS[cls]} — termin przeglądu mają tylko pliki żywe (plik „kamień milowy”: expires)`,
      );
    } else if (value < today) {
      record.expired.push(`${field} ${value}`);
      report(
        'expired',
        field === 'expires'
          ? `przeterminowany: expires ${value} (dzisiaj ${today}) — do decyzji przy /milestone close: usunięcie albo nowy termin`
          : `przeterminowany: review_by ${value} (dzisiaj ${today}) — przejrzyj aktualność dokumentu i ustaw nowy review_by`,
        'warning',
      );
    }
  }
}

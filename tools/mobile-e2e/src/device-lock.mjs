// @ts-check
/**
 * Device step of the lock scenarios (EVM-146 AC1; security requirements SR-MOB-03, SR-MOB-08): while the app is locked its tree of views holds none of the
 * synthetic control values of the order, the customer and the form - in `text`, `content-desc`, `hint` and `resource-id` - and that is judged on the UNCOMPRESSED
 * dump of `uiautomator`, which also carries the views "not important for accessibility" (the compressed dump and the hierarchy view of Maestro leave them out and
 * prove nothing). Like the other device steps the verdict reports counts and the NAMES of the synthetic values and the attribute - never a line of the tree.
 *
 * An empty dump, a dump that is not the tree of the app, or a tree without the cover "Aplikacja zablokowana" is a FAILURE (an empty proof is not a pass; the same
 * rule as `device-video.mjs`): the check must see the cover, so that "no values" cannot come from a dump taken of the wrong screen.
 * The tree is sampled several times (SAMPLES, a second apart): the decision to lock comes before the first render of the content, so no sample may hold a value.
 * @typedef {'view-tree-locked'} LockAction
 * @typedef {{ status: number | null, stdout: string, stderr: string }} Outcome
 * @typedef {{ adb: (...args: string[]) => Outcome, sleep: (ms: number) => Promise<void> }} LockContext
 * @typedef {{ text: string, contentDesc: string, hint: string, resourceId: string, packageName: string }} ViewNode
 */
import { APPLICATION_ID } from './commands.mjs';

export const LOCK_ACTION_NAMES = new Set(['view-tree-locked']);
/** How many times the tree is read, and the pause between the reads. */
export const SAMPLES = 3;
export const SAMPLE_PAUSE_MS = 1000;

/**
 * The synthetic values the flows put on the screens below the cover (the order ZL-E2E-1 of the scenario server, src/sync-stub.mjs, and the word the flow types
 * into the entry form): the number, the title, the customer, the street and the city, the phone, an item of the scope, a stage, a text of the journal, the id of
 * the order (it is in the `testID` of the row of the list) and the typed word. Names for the report are the keys.
 */
export const LOCK_CONTROL_VALUES = Object.freeze({
  'order number': 'ZL-E2E-1',
  'order title': 'Zlecenie testowe 1',
  customer: 'Klient Testowy 1',
  street: 'Testowa',
  city: 'Testowo',
  phone: '000 000 000',
  'phone e164': '+48000000000',
  'scope item': 'Wallbox testowy',
  stage: 'Proces testowy OSD',
  'journal text': 'rozmowa fikcyjna',
  'order id': '30000000-0000-4000-8000-000000000001',
  'typed value': 'Kontrolka146',
});

/** The text of the cover of the locked app (apps/mobile/src/i18n: `lock.title`) and its test id. */
export const COVER_TITLE = 'Aplikacja zablokowana';
export const COVER_ID = 'lock-overlay';

/** Commands of the lock step: the dump goes to the standard output (no file on the device), with the views not important for accessibility (no `--compressed`). */
export const lockCommands = {
  dump: () => ['shell', 'uiautomator dump /dev/tty'],
  /** The compressed one - used only to show that the uncompressed dump holds MORE (the proof that the step looks at the right thing). */
  dumpCompressed: () => ['shell', 'uiautomator dump --compressed /dev/tty'],
};

/** @param {string} action @returns {boolean} */
export function isLockAction(action) {
  return LOCK_ACTION_NAMES.has(action.split(':')[0] ?? '');
}

/** @param {string} value the value of an XML attribute @returns {string} */
export function unescapeXml(value) {
  return value
    .replaceAll(/&#x([0-9a-fA-F]+);/g, (_all, /** @type {string} */ hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replaceAll(/&#(\d+);/g, (_all, /** @type {string} */ dec) => String.fromCodePoint(Number(dec)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/**
 * The nodes of a dump of `uiautomator` (the tag `<node .../>`); `null` when the text has no hierarchy at all.
 * @param {string} xml
 * @returns {ViewNode[] | null}
 */
export function parseViewTree(xml) {
  if (!/<hierarchy\b/.test(xml)) return null;
  /** @type {ViewNode[]} */
  const nodes = [];
  for (const [tag] of xml.matchAll(/<node\b[^>]*>/g)) {
    /** @param {string} name */
    const attribute = (name) => {
      const found = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
      return found === null ? '' : unescapeXml(found[1] ?? '');
    };
    nodes.push({
      text: attribute('text'),
      contentDesc: attribute('content-desc'),
      hint: attribute('hint'),
      resourceId: attribute('resource-id'),
      packageName: attribute('package'),
    });
  }
  return nodes;
}

const ATTRIBUTES = /** @type {const} */ ([
  ['text', 'text'],
  ['contentDesc', 'content-desc'],
  ['hint', 'hint'],
  ['resourceId', 'resource-id'],
]);

/**
 * Which control values are in which attributes of the tree.
 * @param {ViewNode[]} nodes
 * @param {Readonly<Record<string, string>>} [values]
 * @returns {{ value: string, attribute: string, nodes: number }[]}
 */
export function findLeaks(nodes, values = LOCK_CONTROL_VALUES) {
  /** @type {{ value: string, attribute: string, nodes: number }[]} */
  const leaks = [];
  for (const [name, needle] of Object.entries(values)) {
    for (const [field, label] of ATTRIBUTES) {
      const count = nodes.filter((node) => node[field].toLowerCase().includes(needle.toLowerCase())).length;
      if (count > 0) leaks.push({ value: name, attribute: label, nodes: count });
    }
  }
  return leaks;
}

/**
 * Judges one dump: it must be the tree of the app WITH the cover, and hold no control value.
 * @param {Outcome} dump the output of `uiautomator dump /dev/tty`
 * @returns {{ ok: boolean, detail: string, nodes: number }}
 */
export function judgeViewTree(dump) {
  if (dump.status !== 0) return { ok: false, detail: 'the dump of the view tree failed (uiautomator)', nodes: 0 };
  const nodes = parseViewTree(dump.stdout);
  if (nodes === null || nodes.length === 0)
    return { ok: false, detail: 'the dump of the view tree is empty or has no hierarchy (an empty proof is not a pass)', nodes: 0 };
  const own = nodes.filter((node) => node.packageName === APPLICATION_ID);
  if (own.length === 0)
    return {
      ok: false,
      detail: `the dump has ${String(nodes.length)} node(s) but none of the app (another window is in front)`,
      nodes: nodes.length,
    };
  const cover = own.some((node) => node.resourceId.endsWith(COVER_ID) || node.text === COVER_TITLE);
  if (!cover)
    return {
      ok: false,
      detail: `the dump has ${String(own.length)} node(s) of the app but not the cover "${COVER_TITLE}" (the app is not locked)`,
      nodes: own.length,
    };
  const leaks = findLeaks(own);
  if (leaks.length > 0) {
    const text = leaks.map((leak) => `${leak.value} in ${leak.attribute} (${String(leak.nodes)})`).join('; ');
    return {
      ok: false,
      detail: `${String(own.length)} node(s) of the app, LEAK of ${String(leaks.length)} value/attribute pair(s): ${text}`,
      nodes: own.length,
    };
  }
  return {
    ok: true,
    detail: `${String(own.length)} node(s) of the app with the cover: none of the ${String(Object.keys(LOCK_CONTROL_VALUES).length)} control values in text, content-desc, hint or resource-id`,
    nodes: own.length,
  };
}

/**
 * The number of nodes of the app in the compressed and in the uncompressed dump - for the report (the uncompressed one has the views not important for accessibility).
 * @param {Outcome} full @param {Outcome} compressed
 * @returns {{ full: number, compressed: number } | null}
 */
export function compareDumps(full, compressed) {
  if (full.status !== 0 || compressed.status !== 0) return null;
  const count = (/** @type {string} */ xml) => parseViewTree(xml)?.filter((node) => node.packageName === APPLICATION_ID).length ?? 0;
  return { full: count(full.stdout), compressed: count(compressed.stdout) };
}

/**
 * Runs the step: SAMPLES reads of the tree, every one must pass.
 * @param {LockAction} action
 * @param {LockContext} context
 * @returns {Promise<{ action: LockAction, ok: boolean, detail: string }>}
 */
export async function runLockAction(action, context) {
  /** @type {string[]} */
  const details = [];
  let ok = true;
  for (let sample = 1; sample <= SAMPLES; sample += 1) {
    if (sample > 1) await context.sleep(SAMPLE_PAUSE_MS);
    const verdict = judgeViewTree(context.adb(...lockCommands.dump()));
    details.push(`#${String(sample)} ${verdict.ok ? 'ok' : 'FAIL'}: ${verdict.detail}`);
    if (!verdict.ok) ok = false;
  }
  const sizes = compareDumps(context.adb(...lockCommands.dump()), context.adb(...lockCommands.dumpCompressed()));
  if (sizes !== null) details.push(`nodes of the app: uncompressed ${String(sizes.full)}, compressed ${String(sizes.compressed)}`);
  return { action, ok, detail: details.join(' | ') };
}

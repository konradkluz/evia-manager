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
 * The step `view-tree-unlocked` is the POSITIVE CONTROL: the same read of the same screen with the app unlocked must FIND the control values (all of them but the two of `UNLOCKED_NOT_VISIBLE`) (a dump that is empty
 * for another reason would pass every negative check). `view-tree-resume` presses Home, starts the app again and reads the tree several times at once, while the
 * cover is being put on (the decision to lock comes before the first render of the content).
 * @typedef {'view-tree-locked' | 'view-tree-unlocked' | 'view-tree-resume' | 'camera-client-present' | 'camera-client-absent'} LockAction
 * @typedef {{ status: number | null, stdout: string, stderr: string }} Outcome
 * @typedef {{ adb: (...args: string[]) => Outcome, sleep: (ms: number) => Promise<void> }} LockContext
 * @typedef {{ text: string, contentDesc: string, hint: string, resourceId: string, packageName: string }} ViewNode
 */
import { APPLICATION_ID } from './commands.mjs';

export const LOCK_ACTION_NAMES = new Set([
  'view-tree-locked',
  'view-tree-unlocked',
  'view-tree-resume',
  'camera-client-present',
  'camera-client-absent',
]);
/** How many times the tree is read, and the pause between the reads. */
export const SAMPLES = 3;
export const SAMPLE_PAUSE_MS = 1000;
/** The reads while the app comes back from the background (the last one must show the cover) and the pause between them. */
export const RESUME_SAMPLES = 5;
export const RESUME_PAUSE_MS = 200;
/**
 * Control values that the dump of the unlocked form does NOT hold, and why (measured on the emulator, flow 130): the positive control must find EVERY other value, so
 * "none of them while locked" proves something only for values seen when unlocked.
 * - `phone`: the stub gives the phone only as E.164 (src/sync-stub.mjs), so the text "000 000 000" is not on any screen.
 * - `journal text`: the journal sits below the fold of the details; `uiautomator` leaves out what is outside the window (hypothesis: not confirmed on the device).
 */
export const UNLOCKED_NOT_VISIBLE = Object.freeze({
  phone: 'the stub gives the phone only as E.164',
  'journal text': 'the journal is below the fold of the details (outside the window)',
});

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

/** What the positive control must find in the unlocked form: every control value except the two of `UNLOCKED_NOT_VISIBLE`. */
export const UNLOCKED_MUST_SHOW = Object.freeze(Object.keys(LOCK_CONTROL_VALUES).filter((name) => !(name in UNLOCKED_NOT_VISIBLE)));

/** The text of the cover of the locked app (apps/mobile/src/i18n: `lock.title`) and its test id. */
export const COVER_TITLE = 'Aplikacja zablokowana';
export const COVER_ID = 'lock-overlay';

/** The dump goes to a file that only the shell can read, is read back and is removed in the same command (the tree holds no real data on the e2e device anyway). */
const DUMP_FILE = '/data/local/tmp/evia-view-tree.xml';

/** Commands of the lock step: the dump is read from a file that is removed at once, with the views not important for accessibility (no `--compressed`). */
export const lockCommands = {
  dump: () => ['shell', `uiautomator dump ${DUMP_FILE} > /dev/null; cat ${DUMP_FILE}; rm -f ${DUMP_FILE}`],
  home: () => ['shell', 'input', 'keyevent', 'KEYCODE_HOME'],
  /** Starts the app from its launcher entry, like the icon does (the process is alive: a return from the background). */
  launch: () => ['shell', 'monkey', '-p', APPLICATION_ID, '-c', 'android.intent.category.LAUNCHER', '1'],
  /** The compressed one - used only to show that the uncompressed dump holds MORE (the proof that the step looks at the right thing). */
  /** The views of the window of the app as the framework holds them (no special permission): the structural check of S1. */
  top: () => ['shell', 'dumpsys', 'activity', 'top'],
  /** The clients of the camera service: the app must not be one under the cover (S2). */
  cameraService: () => ['shell', 'dumpsys', 'media.camera'],
  dumpCompressed: () => ['shell', `uiautomator dump --compressed ${DUMP_FILE} > /dev/null; cat ${DUMP_FILE}; rm -f ${DUMP_FILE}`],
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
 * @param {Outcome} dump the output of `uiautomator dump` (the file read back)
 * @returns {{ ok: boolean, detail: string, nodes: number }}
 */
export function judgeViewTree(dump) {
  if (dump.status !== 0) return { ok: false, detail: 'the dump of the view tree failed (uiautomator)', nodes: 0 };
  const nodes = parseViewTree(dump.stdout);
  if (nodes === null || nodes.length === 0)
    return {
      ok: false,
      detail: `the dump of the view tree is empty or has no hierarchy (an empty proof is not a pass; output: ${JSON.stringify(dump.stdout.trim().slice(0, 100))})`,
      nodes: 0,
    };
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
    detail: `${String(own.length)} node(s) of the app with the cover: none of the ${String(Object.keys(LOCK_CONTROL_VALUES).length)} control values (${String(UNLOCKED_MUST_SHOW.length)} of them seen when unlocked) in text, content-desc, hint or resource-id`,
    nodes: own.length,
  };
}

/** The placeholders of the screens (the search of the list, the field of the entry): the report says in which attribute the emulator gives them (AC1 names `hint`). */
const PLACEHOLDERS = Object.freeze(['Szukaj: adres, nazwisko, numer', 'Nie wpisuj PESEL']);

/** @param {ViewNode[]} nodes @returns {string} */
function placeholderReport(nodes) {
  const seen = PLACEHOLDERS.flatMap((phrase) =>
    ATTRIBUTES.map(([field, label]) => ({ phrase, label, count: nodes.filter((node) => node[field].includes(phrase)).length })).filter(
      (entry) => entry.count > 0,
    ),
  );
  return seen.length === 0
    ? 'placeholder: not in the tree'
    : `placeholder: ${seen.map((entry) => `"${entry.phrase}" in ${entry.label} (${String(entry.count)})`).join(', ')}`;
}

/**
 * The positive control: the app is unlocked and shows the form, so the dump must hold the control values of UNLOCKED_MUST_SHOW and no cover.
 * @param {Outcome} dump
 * @returns {{ ok: boolean, detail: string, nodes: number }}
 */
export function judgeViewTreeUnlocked(dump) {
  if (dump.status !== 0) return { ok: false, detail: 'the dump of the view tree failed (uiautomator)', nodes: 0 };
  const nodes = parseViewTree(dump.stdout);
  const own = nodes === null ? [] : nodes.filter((node) => node.packageName === APPLICATION_ID);
  if (own.length === 0) return { ok: false, detail: 'the dump holds no node of the app (an empty proof is not a pass)', nodes: 0 };
  if (own.some((node) => node.resourceId.endsWith(COVER_ID) || node.text === COVER_TITLE))
    return {
      ok: false,
      detail: `the cover is in the tree: the app is locked, so this is not the positive control (${String(own.length)} node(s))`,
      nodes: own.length,
    };
  const found = new Set(findLeaks(own).map((leak) => leak.value));
  const missing = UNLOCKED_MUST_SHOW.filter((name) => !found.has(name));
  if (missing.length > 0)
    return {
      ok: false,
      detail: `${String(own.length)} node(s) of the app, but the control did NOT find: ${missing.join(', ')} - the step cannot see what it should hide`,
      nodes: own.length,
    };
  return {
    ok: true,
    detail: `${String(own.length)} node(s) of the app: the unlocked form shows ${[...found].join(', ')}; ${placeholderReport(own)}`,
    nodes: own.length,
  };
}

/**
 * One read while the app returns: a value is a failure whenever it is there; the cover is required only of the last read (the window may not be there yet).
 * @param {Outcome} dump @param {boolean} last
 * @returns {{ ok: boolean, detail: string, nodes: number }}
 */
export function judgeResumeSample(dump, last) {
  if (last) return judgeViewTree(dump);
  const nodes = dump.status === 0 ? parseViewTree(dump.stdout) : null;
  const own = nodes === null ? [] : nodes.filter((node) => node.packageName === APPLICATION_ID);
  if (own.length === 0) return { ok: true, detail: 'no window of the app yet', nodes: 0 };
  const leaks = findLeaks(own);
  if (leaks.length > 0)
    return {
      ok: false,
      detail: `${String(own.length)} node(s) of the app, LEAK: ${leaks.map((leak) => `${leak.value} in ${leak.attribute} (${String(leak.nodes)})`).join('; ')}`,
      nodes: own.length,
    };
  return { ok: true, detail: `${String(own.length)} node(s) of the app, no control value`, nodes: own.length };
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
 * What `uiautomator dump` cannot tell: a view that was REMOVED from the hierarchy, and one that is only INVISIBLE or of size zero, look the same to it (it leaves
 * out what the user cannot see). `dumpsys activity top` lists the views of the window with their visibility flag (`V`, `I`, `G`), so the step counts the React views
 * that are visible together with all their ancestors and the `ReactEditText` among them.
 * Measured on the emulator (2026-11-19, the entry form of ZL-E2E-1): unlocked - 160 React views, all visible, 2 `ReactEditText` (visible); locked - 162 React views of which
 * 9 visible (the cover) and 0 `ReactEditText` visible: the hidden `Activity` keeps the native views of the content, under ONE invisible parent (flag `I`, size 0), so they are
 * in the hierarchy but not visible - which is what the readers of the tree (uiautomator, TalkBack) honour. The limits below sit between those numbers.
 */
export const LOCKED_MAX_VISIBLE_REACT_VIEWS = 25;
export const UNLOCKED_MIN_VISIBLE_REACT_VIEWS = 100;

/**
 * Counts the views of `dumpsys activity top`; `null` when the output has no view hierarchy with React views (no output is a FAILURE of the step, not a pass).
 * @param {string} output
 * @returns {{ react: number, reactVisible: number, editTexts: number, editTextsVisible: number } | null}
 */
export function parseReactViews(output) {
  const lines = output.split(/\r?\n/);
  let react = 0;
  let reactVisible = 0;
  let editTexts = 0;
  let editTextsVisible = 0;
  /** @type {{ depth: number, visible: boolean }[]} */
  let stack = [];
  let base = -1;
  for (const line of lines) {
    if (/^\s*View Hierarchy:\s*$/.test(line)) {
      base = line.search(/\S/);
      stack = [];
      continue;
    }
    if (base < 0 || line.trim() === '') continue;
    const depth = line.search(/\S/);
    if (depth <= base) {
      base = -1;
      continue;
    }
    const found = /^\s*([\w.$]+)\{[0-9a-f]+ ([VIG])/.exec(line);
    if (found === null) continue;
    while (stack.length > 0 && (stack.at(-1)?.depth ?? 0) >= depth) stack.pop();
    const ancestorsVisible = stack.every((entry) => entry.visible);
    const visible = found[2] === 'V';
    stack.push({ depth, visible });
    const name = found[1] ?? '';
    if (!name.startsWith('com.facebook.react.')) continue;
    react += 1;
    const shown = ancestorsVisible && visible;
    if (shown) reactVisible += 1;
    if (name.endsWith('.ReactEditText')) {
      editTexts += 1;
      if (shown) editTextsVisible += 1;
    }
  }
  return react === 0 ? null : { react, reactVisible, editTexts, editTextsVisible };
}

/**
 * The structural check (S1): locked - only the cover is visible (few React views, no text field); unlocked (the positive control) - the form is visible.
 * @param {Outcome} top the output of `dumpsys activity top`
 * @param {boolean} locked
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeStructure(top, locked) {
  if (top.status !== 0) return { ok: false, detail: 'structure: dumpsys activity top failed (adb)' };
  const counts = parseReactViews(top.stdout);
  if (counts === null) return { ok: false, detail: 'structure: no React views in dumpsys activity top (an empty proof is not a pass)' };
  const numbers = `React views ${String(counts.react)} (visible ${String(counts.reactVisible)}), ReactEditText ${String(counts.editTexts)} (visible ${String(counts.editTextsVisible)})`;
  if (locked) {
    const bad = [];
    if (counts.reactVisible > LOCKED_MAX_VISIBLE_REACT_VIEWS)
      bad.push(`more than ${String(LOCKED_MAX_VISIBLE_REACT_VIEWS)} visible React views (only the cover may be visible)`);
    if (counts.editTextsVisible > 0) bad.push('a ReactEditText is visible');
    return { ok: bad.length === 0, detail: `structure locked: ${numbers}${bad.length === 0 ? '' : ` - FAIL: ${bad.join('; ')}`}` };
  }
  const bad = [];
  if (counts.reactVisible < UNLOCKED_MIN_VISIBLE_REACT_VIEWS)
    bad.push(
      `fewer than ${String(UNLOCKED_MIN_VISIBLE_REACT_VIEWS)} visible React views (the control cannot see the content it should hide)`,
    );
  if (counts.editTextsVisible === 0) bad.push('no ReactEditText visible');
  return { ok: bad.length === 0, detail: `structure unlocked: ${numbers}${bad.length === 0 ? '' : ` - FAIL: ${bad.join('; ')}`}` };
}

/**
 * Runs the step: SAMPLES reads of the tree, every one must pass.
 * @param {LockAction} action
 * @param {LockContext} context
 * @returns {Promise<{ action: LockAction, ok: boolean, detail: string }>}
 */
export async function runLockAction(action, context) {
  if (action === 'camera-client-present' || action === 'camera-client-absent') {
    const verdict = await pollCameraClients(action === 'camera-client-present', context);
    return { action, ok: verdict.ok, detail: verdict.detail };
  }
  if (action === 'view-tree-unlocked') {
    const verdict = judgeViewTreeUnlocked(context.adb(...lockCommands.dump()));
    const structure = judgeStructure(context.adb(...lockCommands.top()), false);
    return { action, ok: verdict.ok && structure.ok, detail: `${verdict.detail} | ${structure.detail}` };
  }
  if (action === 'view-tree-resume') {
    const home = context.adb(...lockCommands.home());
    const launch = home.status === 0 ? context.adb(...lockCommands.launch()) : home;
    if (launch.status !== 0) return { action, ok: false, detail: 'Home or the start of the app failed (adb)' };
    /** @type {string[]} */
    const reads = [];
    let good = true;
    for (let sample = 1; sample <= RESUME_SAMPLES; sample += 1) {
      if (sample > 1) await context.sleep(RESUME_PAUSE_MS);
      const verdict = judgeResumeSample(context.adb(...lockCommands.dump()), sample === RESUME_SAMPLES);
      reads.push(`#${String(sample)} ${verdict.ok ? 'ok' : 'FAIL'}: ${verdict.detail}`);
      if (!verdict.ok) good = false;
    }
    return { action, ok: good, detail: reads.join(' | ') };
  }
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
  const structure = judgeStructure(context.adb(...lockCommands.top()), true);
  details.push(structure.detail);
  return { action, ok: ok && structure.ok, detail: details.join(' | ') };
}

/** How often the camera service is read while it is waited for (the release follows the hide of the screen by a moment), and the pause between the reads. */
export const CAMERA_POLLS = 8;
export const CAMERA_POLL_PAUSE_MS = 1000;

/**
 * The number of active clients of the camera service that belong to the app (`Active Camera Clients:` of `dumpsys media.camera`); `null` when the output has
 * no such list at all (a failed or foreign output is not "no client").
 * @param {string} output
 * @param {string} [packageName]
 * @returns {number | null}
 */
export function parseCameraClients(output, packageName = APPLICATION_ID) {
  const start = output.indexOf('Active Camera Clients:');
  if (start < 0) return null;
  const rest = output.slice(start);
  const end = rest.search(/Allowed user IDs|\n==/);
  const section = end < 0 ? rest : rest.slice(0, end);
  return section
    .split('Client Package Name: ')
    .slice(1)
    .filter((part) => part.startsWith(`${packageName},`)).length;
}

/**
 * The camera step (S2): while the camera of the app is open (`present`) the app IS an active client; under the cover (`!present`) it must NOT be.
 * @param {Outcome} dump the output of `dumpsys media.camera`
 * @param {boolean} present
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeCameraClients(dump, present) {
  if (dump.status !== 0) return { ok: false, detail: 'dumpsys media.camera failed (adb)' };
  const clients = parseCameraClients(dump.stdout);
  if (clients === null)
    return { ok: false, detail: 'no list of active camera clients in dumpsys media.camera (an empty proof is not a pass)' };
  if (present)
    return clients > 0
      ? { ok: true, detail: `the app is an active client of the camera service (${String(clients)}): the control sees what it should find` }
      : { ok: false, detail: 'the camera is open but the app is not a client of the camera service - the control is blind' };
  return clients === 0
    ? { ok: true, detail: 'the camera service has no active client of the app under the cover (the camera is released)' }
    : { ok: false, detail: `the app is still an active client of the camera service (${String(clients)}) under the cover` };
}

/**
 * Reads the camera service until the verdict is the wanted one (the release follows the lock by a moment) or the reads are used up.
 * @param {boolean} present
 * @param {LockContext} context
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
async function pollCameraClients(present, context) {
  /** @type {{ ok: boolean, detail: string }} */
  let verdict = { ok: false, detail: 'not read' };
  for (let read = 1; read <= CAMERA_POLLS; read += 1) {
    if (read > 1) await context.sleep(CAMERA_POLL_PAUSE_MS);
    verdict = judgeCameraClients(context.adb(...lockCommands.cameraService()), present);
    if (verdict.ok) return { ok: true, detail: `${verdict.detail} (read ${String(read)})` };
  }
  return { ok: false, detail: `${verdict.detail} (after ${String(CAMERA_POLLS)} reads)` };
}

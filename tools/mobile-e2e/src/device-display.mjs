// @ts-check
/**
 * Device steps of the font-scale scenarios (EVM-151 AC5): the system font scale and the width of the screen in dp, set with `adb shell` before a flow and put
 * back after it. `display:font=<scale>[,dp=<width>]` sets `settings put system font_scale` and, with `dp`, the density (`wm density`) that gives that width in dp for
 * the physical width of the screen (read with `wm size`); `display-reset` puts both back (font 1.0, `wm density reset`). The scenarios reset before the first step, after the
 * last one and on a failure (`onFail`), so a red run never leaves the emulator magnified.
 * @typedef {`display:${string}` | 'display-reset'} DisplayAction
 * @typedef {{ status: number | null, stdout: string, stderr: string }} Outcome
 * @typedef {{ adb: (...args: string[]) => Outcome, sleep: (ms: number) => Promise<void> }} DisplayContext
 * @typedef {{ fontScale: number, widthDp: number | null }} DisplaySetting
 */

export const DISPLAY_ACTION_NAMES = new Set(['display', 'display-reset']);
/** The pause after a change: the app lays itself out again (the activity handles the change of the configuration). */
export const SETTLE_MS = 2000;
const MIN_FONT = 0.85;
const MAX_FONT = 2;
const MIN_DP = 300;
const MAX_DP = 600;
const DP_PER_INCH = 160;

/** Commands of the steps (arguments of adb after `-s <serial>`). */
export const displayCommands = {
  setFont: (/** @type {number} */ scale) => ['shell', 'settings', 'put', 'system', 'font_scale', String(scale)],
  size: () => ['shell', 'wm', 'size'],
  setDensity: (/** @type {number} */ density) => ['shell', 'wm', 'density', String(density)],
  resetDensity: () => ['shell', 'wm', 'density', 'reset'],
};

/** @param {string} action @returns {boolean} */
export function isDisplayAction(action) {
  return DISPLAY_ACTION_NAMES.has(action.split(':')[0] ?? '');
}

/**
 * @param {string} action `display:font=2` or `display:font=1.3,dp=360`
 * @returns {DisplaySetting | null} null for a text that is not a valid setting
 */
export function parseDisplayAction(action) {
  const [name, rest = ''] = action.split(':');
  if (name !== 'display') return null;
  /** @type {Record<string, string>} */
  const values = {};
  for (const part of rest.split(',')) {
    const [key = '', value = ''] = part.split('=');
    if (!/^(font|dp)$/.test(key) || !/^\d+(\.\d+)?$/.test(value) || key in values) return null;
    values[key] = value;
  }
  if (values.font === undefined) return null;
  const fontScale = Number(values.font);
  const widthDp = values.dp === undefined ? null : Number(values.dp);
  if (fontScale < MIN_FONT || fontScale > MAX_FONT) return null;
  if (widthDp !== null && (!Number.isInteger(widthDp) || widthDp < MIN_DP || widthDp > MAX_DP)) return null;
  return { fontScale, widthDp };
}

/**
 * The physical width in pixels from the answer of `wm size` ("Physical size: 1080x2400", maybe with an "Override size" line that is ignored).
 * @param {string} output
 * @returns {number | null}
 */
export function physicalWidth(output) {
  const found = /Physical size:\s*(\d+)x\d+/.exec(output);
  return found === null ? null : Number(found[1]);
}

/** The density (dpi) that makes a screen of `widthPx` pixels `widthDp` dp wide. @param {number} widthPx @param {number} widthDp */
export function densityFor(widthPx, widthDp) {
  return Math.round((widthPx * DP_PER_INCH) / widthDp);
}

/**
 * @param {DisplayAction} action
 * @param {DisplayContext} context
 * @returns {Promise<{ action: DisplayAction, ok: boolean, detail: string }>}
 */
export async function runDisplayAction(action, context) {
  const { adb, sleep } = context;
  if (action === 'display-reset') {
    const font = adb(...displayCommands.setFont(1));
    const density = adb(...displayCommands.resetDensity());
    await sleep(SETTLE_MS);
    const ok = font.status === 0 && density.status === 0;
    return { action, ok, detail: ok ? 'font scale 1.0 and the default density' : 'the reset of the font scale or of the density failed' };
  }
  const setting = parseDisplayAction(action);
  if (setting === null) return { action, ok: false, detail: 'the setting is not valid (display:font=<0.85-2>[,dp=<300-600>])' };
  if (adb(...displayCommands.setFont(setting.fontScale)).status !== 0)
    return { action, ok: false, detail: 'the font scale could not be set' };
  let width = 'the width of the screen as it is';
  if (setting.widthDp !== null) {
    const size = adb(...displayCommands.size());
    const pixels = size.status === 0 ? physicalWidth(size.stdout) : null;
    if (pixels === null) return { action, ok: false, detail: 'the size of the screen could not be read' };
    if (adb(...displayCommands.setDensity(densityFor(pixels, setting.widthDp))).status !== 0)
      return { action, ok: false, detail: 'the density could not be set' };
    width = `${String(setting.widthDp)} dp wide`;
  }
  await sleep(SETTLE_MS);
  return { action, ok: true, detail: `font scale ${String(setting.fontScale)}, ${width}` };
}

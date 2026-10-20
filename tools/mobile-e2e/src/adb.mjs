// @ts-check
/**
 * Parsing of `adb devices` and the choice of THE emulator (EVM-009 AC4; ADR-0015): the machine has one emulator, and two running
 * at once exhaust it, so more than one emulator is a refusal, never a guess.
 */

/** @typedef {{ serial: string, state: string }} Device */

/**
 * @param {string} output stdout of `adb devices`
 * @returns {Device[]}
 */
export function parseAdbDevices(output) {
  /** @type {Device[]} */
  const devices = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('List of devices') || line.startsWith('*')) continue;
    const [serial, state] = line.split(/\s+/);
    if (serial !== undefined && state !== undefined) devices.push({ serial, state });
  }
  return devices;
}

/** @param {Device[]} devices */
export function emulatorsOf(devices) {
  return devices.filter((device) => /^emulator-\d+$/.test(device.serial));
}

/**
 * @param {Device[]} devices
 * @returns {{ ok: true, serial: string } | { ok: false, reason: 'none' | 'several' | 'not-ready', serials: string[] }}
 */
export function selectEmulator(devices) {
  const emulators = emulatorsOf(devices);
  const serials = emulators.map((device) => device.serial);
  const [only] = emulators;
  if (only === undefined) return { ok: false, reason: 'none', serials };
  if (emulators.length > 1) return { ok: false, reason: 'several', serials };
  return only.state === 'device' ? { ok: true, serial: only.serial } : { ok: false, reason: 'not-ready', serials };
}
